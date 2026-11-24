import type { Role } from "../Role.js";

/** The cargo an account is on: its `role`, and for `custom` the cargo created in Equipo. */
export interface UserRoleAssignment {
  role: Role;
  profileId: string | null;
}

/**
 * Deliberadamente estreita — NÃO estende IBaseRepository<T>. Um
 * `update` genérico nessa tabela violaria a regra "role só muda pelo
 * usecase dedicado de promoção" (CLAUDE.md §8, "Gestão de cargos").
 */
export interface IUserRoleRepository {
  findAssignmentByUserId(userId: string): Promise<UserRoleAssignment | null>;
  updateAssignment(userId: string, assignment: UserRoleAssignment): Promise<void>;
}
