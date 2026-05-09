export class BadRequestError extends Error {
  readonly code = 'bad_request';
}

export class NotPrimaryUserError extends Error {
  readonly code = 'not_primary';
}

export class MemberNotFoundError extends Error {
  readonly code = 'member_not_found';
}

export class CannotRemovePrimaryError extends Error {
  readonly code = 'cannot_remove_primary';
}
