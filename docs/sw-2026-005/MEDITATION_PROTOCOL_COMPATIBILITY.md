# Meditation evidence identity compatibility

R0 source finding against Meditation4afdc0a852b53f3ce581ae3c08927a6a3a19718d and Routine2b20a113ba23a74b328cdc519800ea790897a09e. No production change made by this note.

Routine's MeditationSessionEvidence and Meditation's MeditationContractFields.statusFromFields/fieldsOf(status) expose seven fields: session ID, protocol, status, required/completed qualified seconds, completion timestamp, last update. Session kind and source binding are not returned. FR-06/FR-10 require the correct morning/restorative kind and associated source; an exact ID and sufficient seconds alone cannot prove those fields. The request already carries kind, source cooldown and Rhythmic Day; Meditation stores kind/sourceCooldownId/sourceRhythmicDayId.

Implementation must provide binding-grade evidence without silently changing existing V1 projections: add queryable sessionKind/sourceCooldownId/sourceRhythmicDayId metadata, keep existing seven-column clients compatible, and verify all expected identity fields in Routine. Missing metadata from a previous companion build is a visible upgrade/capability limitation and must not satisfy a gate. Test prior/new client combinations and exact wrong-kind/source rejection. No personal meditation content or additional permissions needed.

MeditationSessionService.createOrReplaceSession currently preserves qualified seconds while replacing changed metadata, can reset a completed record to PENDING, and omits source IDs from its identical-request comparison. Characterize conflicting replays and stale completion with deterministic tests before a scoped correction; preserve legitimate completion under POL-09. Existing identical replay must remain idempotent. This is a provider-side contract/qualification investigation, not authority to alter policy numbers.

Bindings must persist their full original request tuple. Reader V1 rejects replay with changed expiry, and Meditation accepts nullable expiry; an arbitrary new consumer expiry must not make an approved carried obligation impossible to complete. Retain existing Reader V2 calendar evidence. Resolve retry/expiry handling through reviewed implementation and protocol tests, with no silent gate expiry or destructive migration.

This note is an engineering requirement for A2/B1/B2. The owner-approved policies are unchanged. Routine native80/JS423, Reader106 and Meditation177 baseline tests pass; physical/signature and new identity-metadata cases remain unverified.
