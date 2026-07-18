import { describe, expect, it } from "vitest";
import {
  activeSpotProcurementAttachmentIds,
  retainedSpotProcurementAttachments
} from "./spot-procurement-attachments";

const attachments = [
  {
    fileId: "active-quote",
    purpose: "merchant_quote",
    status: "active"
  },
  {
    fileId: "active-unknown",
    purpose: "legacy_category",
    status: "active"
  },
  {
    fileId: "inactive-quote",
    purpose: "merchant_quote",
    status: "quarantined"
  }
];

describe("spot procurement editable attachments", () => {
  it("selects only active existing files when an edit starts", () => {
    expect(activeSpotProcurementAttachmentIds(attachments)).toEqual([
      "active-quote",
      "active-unknown"
    ]);
  });

  it("never resubmits an inactive file and respects an explicit removal", () => {
    expect(
      retainedSpotProcurementAttachments(attachments, [
        "active-unknown",
        "inactive-quote"
      ])
    ).toEqual([
      {
        fileId: "active-unknown",
        category: "other"
      }
    ]);
  });
});
