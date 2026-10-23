import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { CannotActOnSelfError, NotFreshlyAuthenticatedError, TeacherRoleLockedError } from "./errors.js";
import type { IAuditLogRepository } from "./ports/IAuditLogRepository.js";
import type { IFreshAuthVerifier } from "./ports/IFreshAuthVerifier.js";
import type { IUserRoleRepository } from "./ports/IUserRoleRepository.js";
import type { Role } from "./Role.js";

export interface PromoteUserRoleInput {
  adminUserId: string;
  adminPassword: string;
  targetUserId: string;
  newRole: Role;
}

export interface PromoteUserRoleOutput {
  targetUserId: string;
  newRole: Role;
}

/**
 * Único caminho para mudar o `role` de alguém (CLAUDE.md §8, "Gestão
 * de cargos"). Exige reautenticação fresca do admin — o plugin admin
 * do Better Auth não garante isso sozinho. Quem chama este usecase
 * (adapter em apps/api) é responsável por envolver updateRole+append
 * na mesma transação de banco; o usecase não sabe de transação.
 */
export class PromoteUserRoleUseCase extends BaseUseCase<PromoteUserRoleInput, PromoteUserRoleOutput> {
  constructor(
    private readonly freshAuthVerifier: IFreshAuthVerifier,
    private readonly userRoleRepository: IUserRoleRepository,
    private readonly auditLogRepository: IAuditLogRepository,
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

    const fromRole = await this.userRoleRepository.findRoleByUserId(input.targetUserId);

    // O cargo `teacher` entra pelo convite e sai pelo quadro de docentes
    // (OOC-79): trocar por aqui deixaria `teachers.user_id` apontando para uma
    // conta de outro cargo, ou um docente sem ficha.
    if (fromRole === "teacher" || input.newRole === "teacher") {
      throw new TeacherRoleLockedError();
    }

    await this.userRoleRepository.updateRole(input.targetUserId, input.newRole);

    await this.auditLogRepository.append({
      actorId: input.adminUserId,
      action: "role.promote",
      targetId: input.targetUserId,
      metadata: { fromRole, newRole: input.newRole },
      at: new Date(),
    });

    return { targetUserId: input.targetUserId, newRole: input.newRole };
  }
}
