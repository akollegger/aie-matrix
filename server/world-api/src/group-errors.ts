import { Data } from "effect";

export class GroupNotFound extends Data.TaggedError("GroupError.NotFound")<{
  readonly groupId: string;
}> {}

export class GroupDissolved extends Data.TaggedError("GroupError.Dissolved")<{
  readonly groupId: string;
}> {}

export class GroupNotMember extends Data.TaggedError("GroupError.NotMember")<{
  readonly groupId: string;
  readonly actorId: string;
}> {}

export class GroupNotParticipant extends Data.TaggedError("GroupError.NotParticipant")<{
  readonly groupId: string;
  readonly actorId: string;
}> {}

export class GroupNotMemberOrParticipant extends Data.TaggedError("GroupError.NotMemberOrParticipant")<{
  readonly groupId: string;
  readonly actorId: string;
}> {}

export class GroupAntesMismatch extends Data.TaggedError("GroupError.AntesMismatch")<{
  readonly expected: number;
  readonly got: number;
  readonly resource: string;
}> {}

export class GroupResourceMismatch extends Data.TaggedError("GroupError.ResourceMismatch")<{
  readonly giveResource: string;
  readonly receiveResource: string;
}> {}

export class GroupOfferNotFound extends Data.TaggedError("GroupError.OfferNotFound")<{
  readonly offerId: string;
}> {}

export class GroupOfferExpired extends Data.TaggedError("GroupError.OfferExpired")<{
  readonly offerId: string;
}> {}

export class GroupDuplicateOffer extends Data.TaggedError("GroupError.DuplicateOffer")<{
  readonly groupId: string;
  readonly prospectId: string;
}> {}

export class GroupPersistenceError extends Data.TaggedError("GroupError.Persistence")<{
  readonly message: string;
}> {}

export class GroupChatStoreError extends Data.TaggedError("GroupError.ChatStore")<{
  readonly message: string;
}> {}

export type GroupError =
  | GroupNotFound
  | GroupDissolved
  | GroupNotMember
  | GroupNotParticipant
  | GroupNotMemberOrParticipant
  | GroupAntesMismatch
  | GroupResourceMismatch
  | GroupOfferNotFound
  | GroupOfferExpired
  | GroupDuplicateOffer
  | GroupPersistenceError
  | GroupChatStoreError;
