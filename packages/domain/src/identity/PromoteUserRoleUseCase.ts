import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { CannotActOnSelfError, NotFreshlyAuthenticatedError, TeacherRoleLockedError } from "./errors.js";
import type { IAuditLogRepository } from "./ports/IAuditLogRepository.js";
import type { IFreshAuthVerifier } from "./ports/IFreshAuthVerifier.js";
import type { IUserRoleRepository, UserRoleAssignment } from "./ports/IUserRoleRepository.js";
import type { Role } from "./Role.js";
import type { IStaffProfileRepository } from "./staffProfile/IStaffProfileRepository.js";
import { assertWithinActor } from "./staffProfile/StaffProfile.js";
import { cargoPermissions, comparablePermissions } from "./staffProfile/cargoPermissions.js";
import { StaffProfileLockedError } from "./staffProfile/errors.js";

export interface PromoteUserRoleInput {
  adminUserId: string;
  adminPassword: string;
  /** What the acting account's own cargo lets it do (anti-escalation, OOC-183). */
  adminPermissions: ReadonlySet<string>;
  targetUserId: string;
  newRole: Role;
  /** The cargo created in Equipo, when `newRole` is `custom`. */
  newProfileId?: string | null;
}

export interface PromoteUserRoleOutput {
  targetUserId: string;
  newRole: Role;
  newProfileId: string | null;
}

/**
 * Único caminho para mudar o cargo de alguém (CLAUDE.md §8, "Gestão de
 * cargos"). Exige reautenticação fresca — o plugin admin do Better Auth não
 * garante isso sozinho. Desde a OOC-183 o cargo pode ser um criado em Equipo,
 * e a trava anti-escalada compara permissões: quem troca precisa ter tudo o
 * que o cargo novo dá **e** tudo o que o cargo atual da pessoa dá — ninguém
 * entrega mais do que tem, nem rebaixa quem pode mais. Quem chama este
 * usecase (adapter em apps/api) é responsável por envolver a escrita e o
 * append na mesma transação de banco; o usecase não sabe de transação.
 */
export class PromoteUserRoleUseCase extends BaseUseCase<PromoteUserRoleInput, PromoteUserRoleOutput> {
  constructor(
    private readonly freshAuthVerifier: IFreshAuthVerifier,
    private readonly userRoleRepository: IUserRoleRepository,
    private readonly auditLogRepository: IAuditLogRepository,
    private readonly staffProfiles: IStaffProfileRepository,
  ) {
    super();
  }

  async run(input: PromoteUserRoleInput): Promise<PromoteUserRoleOutput> {
    if (input.adminUserId === input.targetUserId) {
      throw new CannotActOnSelfError();
    }

    const isFreshlyAuthenticated = await this.freshAuthVerifier.verify(input.adminUserId, input.adminPassword);

    if (!isFreshlyAuthenticated) {
      throw new NotFreshlyAuthenticatedError();
    }

    const from = await this.userRoleRepository.findAssignmentByUserId(input.targetUserId);

    // O cargo `teacher` entra pelo convite e sai pelo quadro de docentes
    // (OOC-79): trocar por aqui deixaria `teachers.user_id` apontando para uma
    // conta de outro cargo, ou um docente sem ficha.
    if (from?.role === "teacher" || input.newRole === "teacher") {
      throw new TeacherRoleLockedError();
    }
    // Master is born through the owners'-domain invite, never promoted into.
    if (input.newRole === "master" || input.newRole === "student" || input.newRole === "guardian") {
      throw new StaffProfileLockedError();
    }

    const to: UserRoleAssignment = {
      role: input.newRole,
      profileId: input.newRole === "custom" ? (input.newProfileId ?? null) : null,
    };

    assertWithinActor(input.adminPermissions, comparablePermissions(await cargoPermissions(this.staffProfiles, to)));
    if (from) {
      assertWithinActor(
        input.adminPermissions,
        comparablePermissions(await cargoPermissions(this.staffProfiles, from)),
      );
    }

    await this.userRoleRepository.updateAssignment(input.targetUserId, to);

    await this.auditLogRepository.append({
      actorId: input.adminUserId,
      action: "role.promote",
      targetId: input.targetUserId,
      metadata: {
        fromRole: from?.role ?? null,
        newRole: to.role,
        ...(from?.profileId ? { fromProfileId: from.profileId } : {}),
        ...(to.profileId ? { newProfileId: to.profileId } : {}),
      },
      at: new Date(),
    });

    return { targetUserId: input.targetUserId, newRole: to.role, newProfileId: to.profileId };
  }
}
