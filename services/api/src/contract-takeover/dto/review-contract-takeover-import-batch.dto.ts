export type ContractTakeoverImportBatchReviewStatus =
  | "under_review"
  | "accepted"
  | "limited_accepted"
  | "disputed";

export interface ReviewContractTakeoverImportBatchDto {
  status: ContractTakeoverImportBatchReviewStatus;
  reviewComment?: string;
  acceptanceConclusion?: string;
}
