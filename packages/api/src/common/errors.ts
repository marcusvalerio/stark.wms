export class AppError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 400, code = "APP_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string, id?: string) {
    super(id ? `${entity} não encontrado: ${id}` : `${entity} não encontrado.`, 404, "NOT_FOUND");
  }
}

export class ValidationError extends AppError {
  constructor(message: string, readonly details?: unknown) {
    super(message, 422, "VALIDATION_ERROR");
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, "CONFLICT");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Você não tem permissão para executar esta ação.") {
    super(message, 403, "FORBIDDEN");
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Credenciais inválidas ou sessão expirada.") {
    super(message, 401, "UNAUTHORIZED");
  }
}

export class InvalidStateTransitionError extends AppError {
  constructor(entity: string, from: string, to: string) {
    super(`${entity}: transição de estado inválida (${from} → ${to}).`, 409, "INVALID_STATE_TRANSITION");
  }
}

export class InsufficientStockError extends AppError {
  constructor(message = "Estoque insuficiente.") {
    super(message, 409, "INSUFFICIENT_STOCK");
  }
}

export class LocationCapacityError extends AppError {
  constructor(message = "Endereço não possui capacidade suficiente.") {
    super(message, 409, "LOCATION_CAPACITY_EXCEEDED");
  }
}

export class IncompatibleLocationError extends AppError {
  constructor(message = "Endereço incompatível com o produto.") {
    super(message, 409, "INCOMPATIBLE_LOCATION");
  }
}
