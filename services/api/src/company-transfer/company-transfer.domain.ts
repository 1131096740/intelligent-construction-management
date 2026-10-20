import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";
export const TRANSFER_KINDS = ["storage", "loan", "repayment"] as const;
export const TRANSFER_LABELS = { storage: "资金转存", loan: "临时借款调剂", repayment: "归还已有往来" };
export const TRANSFER_APPROVAL_NODES = [{ name: "董事长或总经理终审", mode: "any", roleKeys: ["chairman", "general_manager"] }];
export function accountIdentity(value: unknown) { if (typeof value !== "string") throw new BadRequestException("请填写完整银行账号"); const account = value.normalize("NFKC").replace(/[\s-]/gu, "").toLowerCase(); if (!/^[a-z0-9]{8,40}$/u.test(account)) throw new BadRequestException("银行账号格式不正确"); return { hash: createHash("sha256").update(account).digest("hex"), last4: account.slice(-4) }; }
export function transferTotals(events: ReadonlyArray<{ kind: string; amountCents: bigint }>) { const sum = (kind: string) => events.filter(e => e.kind === kind).reduce((n, e) => n + e.amountCents, 0n); const sent = sum("outgoing"), received = sum("incoming"), returned = sum("returned"); return { sent, received, returned, inTransit: sent - received - returned }; }
export function transferScope(kind: string, source: string | null, destination: string | null) { if (!TRANSFER_KINDS.includes(kind as never)) throw new BadRequestException("公司互转用途无效"); if (kind === "storage" && source !== destination) throw new BadRequestException("转存不能改变资金所属项目；跨项目使用请选择借款调剂"); }
