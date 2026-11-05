# SW-2026-005 policy review

Prepared 29 October 2026. All three policies explicitly APPROVED by the owner in this chat on 29 October 2026; implementation pending. This concise controller contract resolves inconsistencies in the longer worker drafts. The programme PRD remains authoritative.

The PRD's R0/FR-01/FR-03/FR-11 require an owner decision on these behavioural ambiguities before the affected implementation. Existing policy numbers, Essential access, Reader V2 calendar evidence and no ordinary lease bypass of morning focus are already requirements and are not being reopened.

1. **Daily accounting boundary:** use the configured morning-end clock every civil day, including inactive weekends and disabled windows. If no valid clock is configured, use local midnight. Inactive windows create no morning/evening restriction or mandatory morning session; independent risk-group rules still apply. Calendar arithmetic handles daylight-saving changes.

2. **Unfinished obligations and schedule changes:** carry an unfinished gate across a day boundary until verified completion, retaining its original identity, timer, evidence rules and owning-day substitution ledger. Schedule edits cannot end the current accounting day early or clear an obligation; pin the current day and use the later of its persisted next boundary and the proposed new boundary for the one-time transition. New days receive their own counters; late completion is charged once to the gate's original day. Preserve Reader V2's existing accepted calendar-date semantics; carrying a gate does not redefine evidence as an Attention-Day aggregate. Keep restriction-window configuration independent of the accounting boundary. Show carried obligations explicitly. Risk-group deletion retains its existing explicit deletion behaviour; no new silent expiry or abandonment shortcut.

3. **Reader/Meditation choice:** allow a switch while authoritative evidence confirms no meaningful progress. Keep one stable session ID for each gate/provider, including when switching back. An unselected binding is inactive, not permanently destroyed; only the currently selected provider can satisfy the gate, and evidence from both providers never combines. Before switching, reconcile existing bindings; unknown evidence cannot be treated as confirmed zero progress. Lock provider choice once progress is verified. A normal retry or double-tap always reuses the same binding.

These decisions authorize bounded feature implementation and tests only. Device installation, protected merges, tags and publication retain the PRD's later owner gates. No phone is requested at this stage.

Owner response: “Approve all three policies.” Evidence: reply to the policy approval question in this chat. This does not authorize device installation, protected merges, tags or release.
