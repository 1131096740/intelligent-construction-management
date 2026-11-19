import { ConflictException } from "@nestjs/common";
import { readLayoutSourcePositions, type LayoutSourceMapping } from "../contract-template/layout-field-mapping";
import { reviewedBuiltinTemplateKind } from "./builtin-template-parts";

export const AUTOMATIC_PARTY_GUARD_PREFIX = "built-in-automatic-party-guard-v1:";

const ownerKeys = new Set(["party.owner.name", "party.party_a.name"]);
const counterpartyKeys = new Set(["party.counterparty.name", "party.party_b.name", "field.counterpartyName"]);
const bankKeys = new Set(["party.owner", "party.counterparty", "party.party_a", "party.party_b"].flatMap(role => ["openingBank", "bankAccount", "paymentBank", "paymentAccount"].map(field => `${role}.${field}`)));

/** Bind automatic identity to the exact source spans handled by the reviewed layout. */
export function assertAutomaticPartyMapping(source: Buffer, mapping: LayoutSourceMapping | undefined): void {
  if (!mapping) return;
  const kind = reviewedBuiltinTemplateKind(source);
  if (!kind) return;
  const parsed = readLayoutSourcePositions(source);
  const positions = new Map(parsed.positions.map(position => [position.positionId, position]));
  const roles = kind === "generic" ? { owner: [13, 53], counterparty: [14, 58] }
    : kind === "labor" ? { owner: [13, 27], counterparty: [14, 28] }
    : kind === "material" ? { owner: [13, 28, 205], counterparty: [14, 29, 212] }
    : { owner: [13, 28, 188], counterparty: [14, 29, 194] };
  for (const binding of mapping.bindings) {
    const isOwner = ownerKeys.has(binding.fieldKey), isCounterparty = counterpartyKeys.has(binding.fieldKey);
    if (!isOwner && !isCounterparty && !bankKeys.has(binding.fieldKey)) continue;
    const position = positions.get(binding.positionId);
    const indices = isOwner ? roles.owner : isCounterparty ? roles.counterparty : [];
    const literal = kind === "generic" ? isOwner ? "建工智管建设有限公司" : "{相对方名称}" : isOwner ? "{甲方名称}" : "{乙方名称}";
    const start = position?.text.indexOf(literal) ?? -1;
    if (!position || position.part !== "word/document.xml" || !indices.includes(position.paragraphIndex) || start < 0 || position.text.lastIndexOf(literal) !== start || binding.start !== start || binding.end !== start + literal.length) {
      throw new ConflictException("自动主体或银行资料位置与模板不一致，请核对版式映射；合同正文内容已保留。");
    }
  }
}
