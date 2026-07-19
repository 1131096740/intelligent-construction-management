import { PaymentReadService } from "./payment-read.service";

describe("PaymentReadService", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-07-08T00:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("builds payment ledger rows and summary from persisted requests and executions", async () => {
    const prisma = {
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "payment-1",
            projectId: "project-1",
            contractId: "contract-1",
            settlementId: "settlement-1",
            code: "FK-2026-011",
            status: "approved_pending_payment",
            requestedAmountCents: 49300000n,
            approvedAmountCents: 49300000n,
            paidAmountCents: 0n,
            updatedAt: new Date("2026-06-30T10:00:00.000Z")
          },
          {
            id: "payment-2",
            projectId: "project-1",
            contractId: "contract-1",
            settlementId: "settlement-2",
            code: "FK-2026-012",
            status: "paid",
            requestedAmountCents: 20000000n,
            approvedAmountCents: 20000000n,
            paidAmountCents: 0n,
            updatedAt: new Date("2026-07-01T10:00:00.000Z")
          }
        ])
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-1",
            code: "JS-2026-031"
          },
          {
            id: "settlement-2",
            code: "JS-2026-032"
          }
        ])
      },
      project: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "project-1",
            name: "总部综合楼"
          }
        ])
      },
      contract: {
        findMany: jest.fn().mockResolvedValue([
          { id: "contract-1", code: "HT-2026-001", name: "材料采购合同" }
        ])
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([
          {
            paymentRequestId: "payment-2",
            amountCents: 20000000n
          }
        ])
      }
    };
    const service = new PaymentReadService(prisma as never);

    const ledger = await service.listRecent(20);

    expect(prisma.paymentRequest.findMany).toHaveBeenCalledWith({
      take: 20,
      orderBy: { updatedAt: "desc" }
    });
    expect(ledger.rows[0]).toMatchObject({
      id: "FK-2026-011",
      paymentNo: "FK-2026-011",
      settlementNo: "JS-2026-031",
      contractNo: "HT-2026-001 · 材料采购合同",
      project: "总部综合楼",
      requestedAmount: "¥493,000.00",
      approvalStatus: "已通过",
      paymentStatus: "已批待付",
      currentNode: "出纳付款登记",
      ownerDepartment: "出纳/财务",
      pendingOwner: "出纳/财务",
      stalledFor: "7天",
      returnReason: "-",
      nextAction: "出纳付款登记"
    });
    expect(ledger.rows[1]).toMatchObject({
      paymentNo: "FK-2026-012",
      paymentStatus: "已付款",
      currentNode: "财务入账归档"
    });
    expect(ledger.summary).toEqual({
      total: 2,
      pendingApproval: 0,
      orSign: 0,
      pendingPayment: 1,
      paid: 1
    });
  });

  it("filters payment ledger by visible projects", async () => {
    const prisma = {
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([])
      },
      settlement: {
        findMany: jest.fn()
      },
      project: {
        findMany: jest.fn()
      },
      contract: {
        findMany: jest.fn()
      },
      paymentExecution: {
        findMany: jest.fn()
      }
    };
    const service = new PaymentReadService(prisma as never);

    await service.listRecent(20, ["project-1"]);

    expect(prisma.paymentRequest.findMany).toHaveBeenCalledWith({
      where: { projectId: { in: ["project-1"] } },
      take: 20,
      orderBy: { updatedAt: "desc" }
    });
  });

  it("projects returned drafts separately from approval work and abandoned requests as ended", async () => {
    const prisma = {
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "payment-returned",
            projectId: "project-1",
            contractId: "contract-1",
            settlementId: "settlement-1",
            code: "FK-RETURNED",
            status: "draft",
            requestedAmountCents: 10_000n,
            approvedAmountCents: null,
            paidAmountCents: 0n,
            updatedAt: new Date("2026-07-19T10:00:00.000Z")
          },
          {
            id: "payment-abandoned",
            projectId: "project-1",
            contractId: "contract-1",
            settlementId: "settlement-1",
            code: "FK-ABANDONED",
            status: "abandoned",
            requestedAmountCents: 20_000n,
            approvedAmountCents: null,
            paidAmountCents: 0n,
            updatedAt: new Date("2026-07-19T11:00:00.000Z")
          }
        ])
      },
      settlement: { findMany: jest.fn().mockResolvedValue([{ id: "settlement-1", code: "JS-1" }]) },
      project: { findMany: jest.fn().mockResolvedValue([{ id: "project-1", name: "项目一" }]) },
      contract: { findMany: jest.fn().mockResolvedValue([{ id: "contract-1", code: "HT-1", name: "合同一" }]) },
      paymentExecution: { findMany: jest.fn().mockResolvedValue([]) },
      approvalInstance: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "approval-returned",
            businessId: "payment-returned",
            status: "returned_to_applicant",
            createdAt: new Date("2026-07-19T09:00:00.000Z")
          }
        ])
      },
      approvalActionLog: {
        findMany: jest.fn().mockResolvedValue([{ approvalInstanceId: "approval-returned" }])
      }
    };
    const service = new PaymentReadService(prisma as never);

    const ledger = await service.listRecent(20);

    expect(ledger.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        paymentNo: "FK-RETURNED",
        lifecycleKind: "approval_draft",
        ledgerView: "returned_for_revision",
        approvalStatus: "退回待修改",
        currentNode: "补充付款申请或放弃申请",
        pendingOwner: "申请人",
        returnReason: "审批退回待修改，查看审批历史"
      }),
      expect.objectContaining({
        paymentNo: "FK-ABANDONED",
        ledgerView: "ended"
      })
    ]));
    expect(ledger.summary.pendingApproval).toBe(0);
  });

  it.each([
    ["applicant-1", true],
    ["other-user", false]
  ] as const)(
    "exposes payment abandonment on returned detail only to the current applicant %s",
    async (actorUserId, expected) => {
      const returnedApproval = {
        id: "approval-returned",
        status: "returned_to_applicant",
        applicantUserId: "applicant-1",
        frozenNodes: [],
        currentNodeIndex: 0
      };
      const prisma = {
        paymentRequest: {
          findFirst: jest.fn().mockResolvedValue({
            id: "payment-returned",
            projectId: "project-1",
            contractId: "contract-1",
            settlementId: "settlement-1",
            contractVersionId: "contract-version-1",
            paymentTermsVersionId: "terms-version-1",
            paymentTermsStageId: null,
            sourceType: "settlement",
            code: "FK-RETURNED",
            status: "draft",
            requestedAmountCents: 10_000n,
            approvedAmountCents: null,
            paidAmountCents: 0n
          })
        },
        settlement: {
          findUnique: jest.fn().mockResolvedValue({
            id: "settlement-1",
            code: "JS-1",
            periodLabel: "本期",
            status: "effective"
          })
        },
        contractVersion: {
          findUnique: jest.fn().mockResolvedValue({ id: "contract-version-1", versionNo: 1 })
        },
        paymentTermsVersion: {
          findUnique: jest.fn().mockResolvedValue({ id: "terms-version-1", versionNo: 1 })
        },
        paymentTermsStage: { findFirst: jest.fn().mockResolvedValue(null) },
        paymentExecution: { findMany: jest.fn().mockResolvedValue([]) },
        financeRecord: { findMany: jest.fn().mockResolvedValue([]) },
        paymentExecutionAllocation: { findMany: jest.fn().mockResolvedValue([]) },
        approvalInstance: {
          findFirst: jest.fn().mockImplementation(({ where }: { where: { status?: string } }) =>
            where.status === "in_progress" ? null : returnedApproval
          )
        },
        approvalActionLog: {
          findFirst: jest.fn().mockResolvedValue({ id: "return-action-1" }),
          findMany: jest.fn().mockResolvedValue([
            {
              id: "return-action-1",
              action: "return_to_applicant",
              actorUserId: "reviewer-1",
              comment: "补充付款依据",
              metadata: null,
              approvedRoleKey: "finance_director",
              representedUserId: "reviewer-1",
              createdAt: new Date("2026-07-19T09:00:00.000Z")
            }
          ])
        },
        user: { findMany: jest.fn().mockResolvedValue([]) }
      };
      const projectVisibility = {
        effectiveRoleKeys: jest.fn().mockResolvedValue([])
      };
      const service = new PaymentReadService(prisma as never, projectVisibility as never);

      const detail = await service.getDetail("payment-returned", undefined, actorUserId);

      expect(detail.availableActions.some((action) => action.key === "abandon_application"))
        .toBe(expected);
      expect(detail).toMatchObject({
        lifecycleKind: "approval_draft",
        ledgerView: "returned_for_revision",
        nextStep: "补充付款申请或放弃申请",
        currentOwner: "申请人",
        returnReason: "审批退回待修改，查看审批历史"
      });
      expect(detail.meta).toContainEqual(
        expect.objectContaining({ label: "审批状态", value: "退回待修改" })
      );
      expect(detail.meta).toContainEqual(
        expect.objectContaining({ label: "下一步动作", value: "补充付款申请或放弃申请" })
      );
    }
  );

  it("does not expose internal payment approval status values in read model labels", () => {
    const service = new PaymentReadService({} as never);
    const approvalStatusView = (
      service as unknown as { approvalStatusView(status: string): { label: string } }
    ).approvalStatusView;

    expect(approvalStatusView.call(service, "internal_status").label).toBe(
      "付款审批状态未读取"
    );
  });

  it("builds payment ledger rows for contract advance requests without settlement", async () => {
    const prisma = {
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "payment-advance-1",
            projectId: "project-1",
            contractId: "contract-advance-1",
            settlementId: null,
            sourceType: "contract_advance",
            code: "FK-YF-2026-001",
            status: "approval_pending",
            requestedAmountCents: 10000000n,
            approvedAmountCents: null,
            paidAmountCents: 0n,
            updatedAt: new Date("2026-07-20T10:00:00.000Z")
          }
        ])
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([])
      },
      project: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "project-1",
            name: "总部综合楼"
          }
        ])
      },
      contract: {
        findMany: jest.fn().mockResolvedValue([
          { id: "contract-advance-1", code: "HT-YF-001", name: "预付款合同" }
        ])
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const service = new PaymentReadService(prisma as never);

    const ledger = await service.listRecent(20);

    expect(prisma.settlement.findMany).not.toHaveBeenCalled();
    expect(ledger.rows[0]).toMatchObject({
      paymentNo: "FK-YF-2026-001",
      settlementNo: "合同预付款",
      contractNo: "HT-YF-001 · 预付款合同",
      project: "总部综合楼",
      requestedAmount: "¥100,000.00",
      approvalStatus: "审批中"
    });
  });

  it("labels new frozen-stage direct payments without using legacy settlement wording", async () => {
    const prisma = {
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([{
          id: "payment-direct-1",
          projectId: "project-1",
          contractId: "contract-1",
          settlementId: null,
          sourceType: "contract_due",
          paymentTermsStageId: "stage-1",
          code: "FK-TY-2026-001",
          status: "approval_pending",
          requestedAmountCents: 100_000n,
          approvedAmountCents: null,
          paidAmountCents: 0n,
          updatedAt: new Date("2026-07-18T00:00:00.000Z")
        }])
      },
      settlement: { findMany: jest.fn().mockResolvedValue([]) },
      project: { findMany: jest.fn().mockResolvedValue([{ id: "project-1", name: "项目一" }]) },
      contract: {
        findMany: jest.fn().mockResolvedValue([{ id: "contract-1", code: "HT-TY-001", name: "通用合同" }])
      },
      paymentExecution: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const service = new PaymentReadService(prisma as never);

    const ledger = await service.listRecent(20);

    expect(ledger.rows[0]?.settlementNo).toBe("合同冻结阶段直接付款");
  });

  it("builds payment detail from persisted payment request and executions", async () => {
    const prisma = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          settlementId: "settlement-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-2",
          paymentTermsVersionId: "terms-version-2",
          code: "FK-2026-011",
          status: "approved_pending_payment",
          requestedAmountCents: 49300000n,
          approvedAmountCents: 49300000n,
          paidAmountCents: 12000000n
        })
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          code: "JS-2026-031",
          periodLabel: "2026-06",
          status: "effective"
        })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-2",
          versionNo: 2
        })
      },
      paymentTermsVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "terms-version-2",
          versionNo: 2
        })
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue({
          id: "stage-progress",
          name: "进度款",
          ratioBps: 8500,
          dueDays: 20,
          requiresInvoice: true
        })
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "execution-1",
            amountCents: 12000000n,
            voucherFileId: "file-voucher-1",
            executedByUserId: "user-cashier",
            createdAt: new Date("2026-07-01T09:00:00.000Z")
          }
        ])
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([{ amountCents: 5000000n }])
      },
      paymentExecutionAllocation: {
        findMany: jest.fn().mockResolvedValue([])
      },
      pdfDocument: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "pdf-document-1",
            fileId: "file-pdf-1",
            templateKey: "payment_finance_archive",
            createdAt: new Date("2026-07-01T10:00:00.000Z")
          }
        ])
      },
      fileObject: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "file-voucher-1",
            originalName: "FK-2026-011-银行回单.pdf",
            mimeType: "application/pdf",
            sizeBytes: 1024,
            uploadedByUserId: "user-cashier",
            createdAt: new Date("2026-07-01T08:55:00.000Z")
          },
          {
            id: "file-pdf-1",
            originalName: "FK-2026-011-财务归档.pdf",
            mimeType: "application/pdf",
            sizeBytes: 2048,
            uploadedByUserId: "user-finance",
            createdAt: new Date("2026-07-01T10:00:00.000Z")
          }
        ])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: "user-cashier", name: "出纳" },
          { id: "user-finance", name: "财务" }
        ])
      }
    };
    const service = new PaymentReadService(prisma as never);

    const detail = await service.getDetail("FK-2026-011");

    expect(prisma.paymentRequest.findFirst).toHaveBeenCalledWith({
      where: { OR: [{ id: "FK-2026-011" }, { code: "FK-2026-011" }] }
    });
    expect(detail.id).toBe("FK-2026-011");
    expect(detail.title).toBe("FK-2026-011 · 2026-06付款申请");
    expect(detail.baseInfo).toContainEqual({ label: "申请金额", value: "¥493,000.00" });
    expect(detail.baseInfo).toContainEqual({ label: "已付金额", value: "¥120,000.00" });
    expect(detail.baseInfo).toContainEqual({ label: "发票要求", value: "需提供发票" });
    expect(detail.approvalSteps.map((step) => step.label)).toEqual([
      "付款申请",
      "综合部主管审批",
      "项目经理审批",
      "财务总监审批",
      "董事长/总经理或签",
      "审批通过"
    ]);
    expect(detail.executionSteps.map((step) => step.label)).toContain("付款凭证上传");
    expect(detail.approvalSteps.at(-1)).toMatchObject({
      label: "审批通过",
      status: "已批待付",
      tone: "warning"
    });
    expect(detail.executionSteps.at(-1)).toMatchObject({
      label: "付款完成",
      status: "未完成",
      tone: "danger"
    });
    expect(detail.evidenceFiles).toEqual([
      {
        recordId: "execution-1",
        fileId: "file-voucher-1",
        fileName: "FK-2026-011-银行回单.pdf",
        purpose: "付款凭证",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        status: "uploaded",
        statusLabel: "已上传",
        uploadedByName: "出纳",
        uploadedAt: "2026-07-01T09:00:00.000Z",
        confirmedByName: null,
        confirmedAt: null,
        canDownload: true,
        disabledReason: null
      },
      {
        recordId: "pdf-document-1",
        fileId: "file-pdf-1",
        fileName: "FK-2026-011-财务归档.pdf",
        purpose: "付款财务归档 PDF",
        mimeType: "application/pdf",
        sizeBytes: 2048,
        status: "archived",
        statusLabel: "已归档",
        uploadedByName: "财务",
        uploadedAt: "2026-07-01T10:00:00.000Z",
        confirmedByName: null,
        confirmedAt: null,
        canDownload: true,
        disabledReason: null
      }
    ]);
    expect(detail.executionCoverages).toEqual([
      {
        id: "execution-1",
        executionCode: "FK-2026-011 · 第1笔",
        paidAt: "2026-07-01T09:00:00.000Z",
        paidAmount: "¥120,000.00",
        voucherName: "FK-2026-011-银行回单.pdf",
        financeRecordedAmount: "¥50,000.00",
        unrecordedAmount: "¥70,000.00",
        coverageStatus: "部分入账"
      }
    ]);
    expect(detail.traceRules).toContain("审批通过不等于实际付款完成");
    expect(detail.chainLinks.map((link) => link.to)).toEqual([
      "/settlements/JS-2026-031",
      "/archives",
      "/audit"
    ]);
  });

  it("does not expose internal user accounts when payment evidence uploader names are unavailable", async () => {
    const prisma = {
      pdfDocument: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "pdf-document-1",
            fileId: "file-pdf-1",
            templateKey: "payment_finance_archive",
            createdAt: new Date("2026-07-01T10:00:00.000Z")
          }
        ])
      },
      fileObject: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "file-voucher-1",
            originalName: "银行回单.pdf",
            mimeType: "application/pdf",
            sizeBytes: 1024,
            uploadedByUserId: "voucher-upload-internal-id",
            createdAt: new Date("2026-07-01T09:00:00.000Z")
          },
          {
            id: "file-pdf-1",
            originalName: "财务归档.pdf",
            mimeType: "application/pdf",
            sizeBytes: 2048,
            uploadedByUserId: "pdf-upload-internal-id",
            createdAt: new Date("2026-07-01T10:00:00.000Z")
          }
        ])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const service = new PaymentReadService(prisma as never);
    const evidenceFiles = await (
      service as unknown as {
        paymentEvidenceFiles(
          paymentId: string,
          executions: Array<{
            id: string;
            voucherFileId?: string | null;
            executedByUserId?: string | null;
            createdAt?: Date;
          }>
        ): Promise<Array<{ uploadedByName: string }>>;
      }
    ).paymentEvidenceFiles("payment-1", [
      {
        id: "execution-1",
        voucherFileId: "file-voucher-1",
        executedByUserId: "executor-internal-id",
        createdAt: new Date("2026-07-01T09:30:00.000Z")
      }
    ]);

    expect(evidenceFiles.map((file) => file.uploadedByName)).toEqual([
      "上传人未读取",
      "上传人未读取"
    ]);
  });

  it("exposes enabled payment execution action for cashier after approval", async () => {
    const prisma = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          projectId: "project-1",
          settlementId: "settlement-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-2",
          paymentTermsVersionId: "terms-version-2",
          code: "FK-2026-011",
          status: "approved_pending_payment",
          requestedAmountCents: 49300000n,
          approvedAmountCents: 49300000n,
          paidAmountCents: 0n
        })
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          code: "JS-2026-031",
          periodLabel: "2026-06",
          status: "effective"
        })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({ id: "contract-version-2", versionNo: 2 })
      },
      paymentTermsVersion: {
        findUnique: jest.fn().mockResolvedValue({ id: "terms-version-2", versionNo: 2 })
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([])
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentExecutionAllocation: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const projectVisibility = {
      effectiveRoleKeys: jest.fn().mockResolvedValue(["finance_staff"])
    };
    const service = new PaymentReadService(prisma as never, projectVisibility as never);

    const detail = await service.getDetail("FK-2026-011", undefined, "user-cashier");

    expect(projectVisibility.effectiveRoleKeys).toHaveBeenCalledWith("user-cashier", "project-1");
    expect(detail.primaryAction).toBe("record_execution");
    expect(detail.availableActions).toContainEqual({
      key: "record_execution",
      label: "登记实际付款",
      kind: "primary",
      enabled: true,
      disabledReason: null,
      requiredAction: "payment.execution",
      requiresPassword: true,
      requiresFile: true
    });
    expect(detail.disabledReasons).toEqual([]);
  });

  it("does not expose payment detail outside visible projects", async () => {
    const prisma = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue(null)
      }
    };
    const service = new PaymentReadService(prisma as never);

    await expect(service.getDetail("FK-2026-011", ["project-1"])).rejects.toThrow(
      "未找到付款申请，请刷新付款台账后重试"
    );
    expect(prisma.paymentRequest.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [{ id: "FK-2026-011" }, { code: "FK-2026-011" }],
        projectId: { in: ["project-1"] }
      }
    });
  });

  it.each([
    {
      name: "linked settlement",
      settlement: null,
      contractVersion: { id: "contract-version-2", versionNo: 2 },
      terms: { id: "terms-version-2", versionNo: 2 },
      message: "未找到关联结算，请先核对结算归档记录"
    },
    {
      name: "contract version",
      settlement: { id: "settlement-1", code: "JS-2026-031", periodLabel: "2026-06", status: "effective" },
      contractVersion: null,
      terms: { id: "terms-version-2", versionNo: 2 },
      message: "未找到关联合同版本，请先核对合同归档记录"
    },
    {
      name: "payment terms version",
      settlement: { id: "settlement-1", code: "JS-2026-031", periodLabel: "2026-06", status: "effective" },
      contractVersion: { id: "contract-version-2", versionNo: 2 },
      terms: null,
      message: "未找到合同付款条款版本，请先核对合同归档记录"
    }
  ])("rejects payment detail when $name cannot be found", async ({ settlement, contractVersion, terms, message }) => {
    const prisma = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          projectId: "project-1",
          settlementId: "settlement-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-2",
          paymentTermsVersionId: "terms-version-2",
          code: "FK-2026-011",
          status: "approved_pending_payment",
          requestedAmountCents: 49300000n,
          approvedAmountCents: 49300000n,
          paidAmountCents: 0n
        })
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue(settlement)
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue(contractVersion)
      },
      paymentTermsVersion: {
        findUnique: jest.fn().mockResolvedValue(terms)
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([])
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const service = new PaymentReadService(prisma as never);

    await expect(service.getDetail("FK-2026-011")).rejects.toThrow(message);
  });

  it("builds contract advance payment detail without requiring settlement", async () => {
    const prisma = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-advance-1",
          sourceType: "contract_advance",
          settlementId: null,
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          code: "FK-YF-2026-001",
          status: "approved_pending_payment",
          requestedAmountCents: 10000000n,
          approvedAmountCents: 10000000n,
          paidAmountCents: 0n
        })
      },
      settlement: {
        findUnique: jest.fn()
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          code: "HT-2026-009",
          name: "幕墙分包合同"
        })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          versionNo: 1
        })
      },
      paymentTermsVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "terms-version-1",
          versionNo: 1
        })
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue({
          id: "stage-advance",
          name: "预付款",
          ratioBps: 1000,
          dueDays: 30
        })
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([])
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentExecutionAllocation: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const service = new PaymentReadService(prisma as never);

    const detail = await service.getDetail("FK-YF-2026-001");

    expect(prisma.settlement.findUnique).not.toHaveBeenCalled();
    expect(prisma.paymentTermsStage.findFirst).toHaveBeenCalledWith({
      where: {
        paymentTermsVersionId: "terms-version-1",
        stageType: "advance",
        basis: "contract_amount",
        triggerAnchor: "contract_effective"
      },
      orderBy: { createdAt: "asc" }
    });
    expect(detail.title).toBe("FK-YF-2026-001 · 合同预付款申请");
    expect(detail.baseInfo).toContainEqual({ label: "付款来源", value: "合同预付款" });
    expect(detail.baseInfo).toContainEqual({ label: "关联合同", value: "HT-2026-009 · 幕墙分包合同" });
    expect(detail.traceRules).toContain("预付款按合同生效日和账期计算，不依赖结算单");
    expect(detail.chainLinks.map((link) => link.to)).toEqual([
      "/contracts/HT-2026-009",
      "/archives",
      "/audit"
    ]);
  });

  it("builds contract-level due payment detail with execution allocation ledger rows", async () => {
    const prisma = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-due-1",
          sourceType: "contract_due",
          settlementId: null,
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          code: "FK-HT-2026-001",
          status: "paid",
          requestedAmountCents: 100_000n,
          approvedAmountCents: 100_000n,
          paidAmountCents: 100_000n
        })
      },
      settlement: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-1",
            code: "JS-2026-031",
            periodLabel: "2026-06"
          },
          {
            id: "settlement-2",
            code: "JS-2026-032",
            periodLabel: "2026-07"
          }
        ])
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          code: "HT-2026-009",
          name: "幕墙分包合同"
        })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          versionNo: 1
        })
      },
      paymentTermsVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "terms-version-1",
          versionNo: 1
        })
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue({
          id: "stage-progress",
          name: "进度款",
          ratioBps: 8000,
          dueDays: 0
        })
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "execution-1",
            amountCents: 60_000n,
            paidAt: new Date("2026-07-01T00:00:00.000Z"),
            createdAt: new Date("2026-07-01T00:00:00.000Z")
          },
          {
            id: "execution-2",
            amountCents: 40_000n,
            paidAt: new Date("2026-07-02T00:00:00.000Z"),
            createdAt: new Date("2026-07-02T00:00:00.000Z")
          }
        ])
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentExecutionAllocation: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "allocation-0",
            paymentExecutionId: "execution-1",
            settlementId: "settlement-1",
            stageName: "进度款",
            stageType: "progress",
            allocationType: "advance_deduction",
            amountCents: 10_000n,
            allocationOrder: 0
          },
          {
            id: "allocation-1",
            paymentExecutionId: "execution-1",
            settlementId: "settlement-1",
            stageName: "进度款",
            stageType: "progress",
            allocationType: "contract_due_payment",
            amountCents: 60_000n,
            allocationOrder: 1
          },
          {
            id: "allocation-2",
            paymentExecutionId: "execution-2",
            settlementId: "settlement-2",
            stageName: "进度款",
            stageType: "progress",
            allocationType: "contract_due_payment",
            amountCents: 40_000n,
            allocationOrder: 0
          }
        ])
      }
    };
    const service = new PaymentReadService(prisma as never);

    const detail = await service.getDetail("FK-HT-2026-001");

    expect(prisma.settlement.findUnique).not.toHaveBeenCalled();
    expect(prisma.paymentExecutionAllocation.findMany).toHaveBeenCalledWith({
      where: { paymentRequestId: "payment-due-1" },
      orderBy: [{ createdAt: "asc" }, { allocationOrder: "asc" }]
    });
    expect(prisma.settlement.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["settlement-1", "settlement-2"] } },
      select: { id: true, code: true, periodLabel: true }
    });
    expect(detail.title).toBe("FK-HT-2026-001 · 合同累计结算付款申请");
    expect(detail.executionAllocations).toEqual([
      {
        id: "allocation-0",
        executionCode: "FK-HT-2026-001 · 第1笔",
        settlementNo: "JS-2026-031 · 2026-06",
        stageName: "进度款",
        allocationType: "预付款扣回",
        amountCents: "10000"
      },
      {
        id: "allocation-1",
        executionCode: "FK-HT-2026-001 · 第1笔",
        settlementNo: "JS-2026-031 · 2026-06",
        stageName: "进度款",
        allocationType: "合同累计结算付款分摊",
        amountCents: "60000"
      },
      {
        id: "allocation-2",
        executionCode: "FK-HT-2026-001 · 第2笔",
        settlementNo: "JS-2026-032 · 2026-07",
        stageName: "进度款",
        allocationType: "合同累计结算付款分摊",
        amountCents: "40000"
      }
    ]);
    expect(detail.traceRules).toContain(
      "付款申请按合同下全部已生效结算累计计算，实付后自动生成分摊台账"
    );
  });

  it("fails closed when a frozen payment stage belongs to another terms version", async () => {
    const prisma = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-generic-1",
          settlementId: null,
          sourceType: "contract_due",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          paymentTermsStageId: "stage-other-terms",
          projectId: "project-1",
          code: "FK-TY-2026-001",
          status: "approval_pending",
          requestedAmountCents: 100_000n,
          approvedAmountCents: null,
          paidAmountCents: 0n
        })
      },
      contract: { findUnique: jest.fn().mockResolvedValue({ id: "contract-1" }) },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({ id: "contract-version-1", versionNo: 1 })
      },
      paymentTermsVersion: {
        findUnique: jest.fn().mockResolvedValue({ id: "terms-version-1", versionNo: 1 })
      },
      paymentTermsStage: {
        findUnique: jest.fn().mockResolvedValue({
          id: "stage-other-terms",
          paymentTermsVersionId: "terms-version-2"
        }),
        findFirst: jest.fn()
      },
      paymentExecution: { findMany: jest.fn().mockResolvedValue([]) },
      financeRecord: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const service = new PaymentReadService(prisma as never);

    await expect(service.getDetail("FK-TY-2026-001")).rejects.toThrow(
      "付款申请冻结的付款阶段与付款条款不一致，请联系管理员核对"
    );
    expect(prisma.paymentTermsStage.findUnique).toHaveBeenCalledWith({
      where: { id: "stage-other-terms" }
    });
    expect(prisma.paymentTermsStage.findFirst).not.toHaveBeenCalled();
  });

  it("does not show actual payment block message before approval passes", async () => {
    const prisma = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          settlementId: "settlement-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          code: "FK-2026-012",
          status: "approval_pending",
          requestedAmountCents: 5000000n,
          approvedAmountCents: null,
          paidAmountCents: 0n
        })
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          code: "JS-2026-032",
          periodLabel: "2026-06",
          status: "effective"
        })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          versionNo: 1
        })
      },
      paymentTermsVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "terms-version-1",
          versionNo: 1
        })
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue({
          id: "stage-progress",
          name: "进度款",
          ratioBps: 8000,
          dueDays: 30
        })
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([])
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentExecutionAllocation: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const service = new PaymentReadService(prisma as never);

    const detail = await service.getDetail("FK-2026-012");

    expect(detail.executionBlockMessage).toContain("付款申请仍在审批中");
    expect(detail.executionBlockMessage).not.toContain("付款审批已通过");
  });

  it("shows partial payment execution as payable instead of waiting for approval", async () => {
    const prisma = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          settlementId: "settlement-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          code: "FK-2026-013",
          status: "partially_paid",
          requestedAmountCents: 5000000n,
          approvedAmountCents: 5000000n,
          paidAmountCents: 2000000n
        })
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          code: "JS-2026-033",
          periodLabel: "2026-06",
          status: "partially_paid"
        })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          versionNo: 1
        })
      },
      paymentTermsVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "terms-version-1",
          versionNo: 1
        })
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([
          { id: "execution-1", amountCents: 2000000n }
        ])
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentExecutionAllocation: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const service = new PaymentReadService(prisma as never);

    const detail = await service.getDetail("FK-2026-013");

    expect(detail.meta).toContainEqual({ label: "实付状态", value: "部分付款", tone: "warning" });
    expect(detail.meta).toContainEqual({ label: "下一步动作", value: "继续出纳付款登记", tone: "warning" });
    expect(detail.approvalSteps.at(-1)).toMatchObject({
      label: "审批通过",
      status: "已批待付",
      tone: "warning"
    });
    expect(detail.executionBlockMessage).toContain("已登记部分实际付款");
  });

  it("exposes finance entry for partially paid requests", async () => {
    const prisma = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          projectId: "project-1",
          settlementId: "settlement-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          code: "FK-2026-013",
          status: "partially_paid",
          requestedAmountCents: 5000000n,
          approvedAmountCents: 5000000n,
          paidAmountCents: 2000000n
        })
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          code: "JS-2026-033",
          periodLabel: "2026-06",
          status: "partially_paid"
        })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          versionNo: 1
        })
      },
      paymentTermsVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "terms-version-1",
          versionNo: 1
        })
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([
          { id: "execution-1", amountCents: 2000000n }
        ])
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentExecutionAllocation: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const projectVisibility = {
      effectiveRoleKeys: jest.fn().mockResolvedValue(["finance_staff"])
    };
    const service = new PaymentReadService(prisma as never, projectVisibility as never);

    const detail = await service.getDetail("FK-2026-013", undefined, "user-finance");

    expect(detail.availableActions).toContainEqual(
      expect.objectContaining({
        key: "record_finance",
        label: "财务入账",
        enabled: true,
        disabledReason: null,
        requiredAction: "payment.finance_record"
      })
    );
  });

  it("keeps payment pdf archive disabled until finance records cover paid amount", async () => {
    const prisma = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          projectId: "project-1",
          settlementId: "settlement-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          code: "FK-2026-014",
          status: "paid",
          requestedAmountCents: 5000000n,
          approvedAmountCents: 5000000n,
          paidAmountCents: 5000000n
        })
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          code: "JS-2026-034",
          periodLabel: "2026-06",
          status: "partially_paid"
        })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({ id: "contract-version-1", versionNo: 1 })
      },
      paymentTermsVersion: {
        findUnique: jest.fn().mockResolvedValue({ id: "terms-version-1", versionNo: 1 })
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([
          { id: "execution-1", amountCents: 5000000n }
        ])
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentExecutionAllocation: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const projectVisibility = {
      effectiveRoleKeys: jest.fn().mockResolvedValue(["finance_staff"])
    };
    const service = new PaymentReadService(prisma as never, projectVisibility as never);

    const detail = await service.getDetail("FK-2026-014", undefined, "user-finance");

    expect(detail.availableActions).toContainEqual(
      expect.objectContaining({
        key: "record_finance",
        enabled: true,
        disabledReason: null
      })
    );
    expect(detail.availableActions).toContainEqual(
      expect.objectContaining({
        key: "archive_pdf",
        enabled: false,
        disabledReason: "财务入账未完成"
      })
    );
  });

  it("enables approval review for a standing delegation recipient", async () => {
    const prisma = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          projectId: "project-1",
          settlementId: "settlement-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          code: "FK-2026-015",
          status: "approval_pending",
          requestedAmountCents: 5000000n,
          approvedAmountCents: null,
          paidAmountCents: 0n
        })
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          code: "JS-2026-035",
          periodLabel: "2026-06",
          status: "effective"
        })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({ id: "contract-version-1", versionNo: 1 })
      },
      paymentTermsVersion: {
        findUnique: jest.fn().mockResolvedValue({ id: "terms-version-1", versionNo: 1 })
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([])
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentExecutionAllocation: {
        findMany: jest.fn().mockResolvedValue([])
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          applicantUserId: "applicant-1",
          frozenNodes: [{
            roleKeys: ["finance_director"],
            candidateUserIdsByRole: { finance_director: ["finance-director-1"] },
            candidateUserIds: ["finance-director-1"]
          }],
          currentNodeIndex: 0
        })
      },
      approvalDelegation: {
        findMany: jest.fn().mockResolvedValue([{ fromUserId: "finance-director-1" }])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: "finance-director-1", isActive: true },
          { id: "delegatee-1", isActive: true }
        ])
      }
    };
    const projectVisibility = {
      effectiveRoleKeys: jest.fn().mockImplementation((userId: string) => {
        if (userId === "finance-director-1") return ["finance_director"];
        return [];
      })
    };
    const service = new PaymentReadService(prisma as never, projectVisibility as never);

    const detail = await service.getDetail("FK-2026-015", undefined, "delegatee-1");

    expect(prisma.approvalInstance.findFirst).toHaveBeenCalledWith({
      where: { businessType: "payment_request", businessId: "payment-1", status: "in_progress" },
      orderBy: { createdAt: "desc" },
      select: { applicantUserId: true, frozenNodes: true, currentNodeIndex: true }
    });
    expect(detail.primaryAction).toBe("review_approval");
    expect(detail.availableActions).toContainEqual(
      expect.objectContaining({
        key: "review_approval",
        enabled: true,
        disabledReason: null
      })
    );
  });

  it("enables governed approval review for a frozen assignment recipient", async () => {
    const prisma = {
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          applicantUserId: "applicant-1",
          frozenNodes: [{
            roleKeys: ["finance_director"],
            candidateUserIdsByRole: { finance_director: ["finance-director-1"] },
            candidateUserIds: ["finance-director-1"],
            assignments: [{
              kind: "transfer",
              fromUserId: "finance-director-1",
              fromRoleKey: "finance_director",
              toUserId: "assigned-1"
            }]
          }],
          currentNodeIndex: 0
        })
      },
      approvalDelegation: { findMany: jest.fn() }
    };
    const service = new PaymentReadService(prisma as never, {} as never) as unknown as {
      canReviewCurrentApproval(
        businessType: string,
        businessId: string,
        projectId: string,
        roleKeys: string[],
        actorUserId: string
      ): Promise<{ canAct: boolean; canReview: boolean }>;
    };

    await expect(service.canReviewCurrentApproval(
      "payment_request",
      "payment-1",
      "project-1",
      [],
      "assigned-1"
    )).resolves.toMatchObject({ canAct: true, canReview: true });
    expect(prisma.approvalDelegation.findMany).not.toHaveBeenCalled();
  });

  it("does not enable standing delegation review when the delegator is inactive", async () => {
    const prisma = {
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          applicantUserId: "applicant-1",
          frozenNodes: [{ roleKeys: ["finance_director"] }],
          currentNodeIndex: 0
        })
      },
      approvalDelegation: {
        findMany: jest.fn().mockResolvedValue([{ fromUserId: "finance-director-1" }])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: "finance-director-1", isActive: false },
          { id: "delegatee-1", isActive: true }
        ])
      }
    };
    const projectVisibility = {
      effectiveRoleKeys: jest.fn().mockImplementation((userId: string) =>
        userId === "finance-director-1" ? ["finance_director"] : []
      )
    };
    const service = new PaymentReadService(prisma as never, projectVisibility as never) as unknown as {
      canReviewCurrentApproval(
        businessType: string,
        businessId: string,
        projectId: string,
        roleKeys: string[],
        actorUserId: string
      ): Promise<{ canReview: boolean }>;
    };

    const access = await service.canReviewCurrentApproval(
      "payment_request",
      "payment-1",
      "project-1",
      [],
      "delegatee-1"
    );

    expect(access.canReview).toBe(false);
  });

  it("为本人发起的总经理付款终审节点返回自审确认标记", async () => {
    const prisma = {
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          applicantUserId: "leader-1",
          frozenNodes: [{ roleKeys: ["chairman", "general_manager"] }],
          currentNodeIndex: 0
        })
      }
    };
    const service = new PaymentReadService(prisma as never) as unknown as {
      canReviewCurrentApproval(
        businessType: string,
        businessId: string,
        projectId: string,
        roleKeys: string[],
        actorUserId: string
      ): Promise<unknown>;
      paymentActions(
        status: string,
        roleKeys: never[],
        access: unknown,
        executionComplete: boolean,
        financeRecordedAmountCents: bigint,
        paidAmountCents: bigint,
        evidenceFiles: never[]
      ): Array<Record<string, unknown>>;
    };

    const access = await service.canReviewCurrentApproval(
      "payment_request",
      "payment-1",
      "project-1",
      ["general_manager"],
      "leader-1"
    );
    expect(access).toEqual({
      canAct: true,
      canReview: true,
      requiresSelfReviewConfirmation: true
    });
    expect(
      service.paymentActions(
        "approval_pending",
        ["general_manager"] as never[],
        access,
        false,
        0n,
        0n,
        []
      )
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "review_approval",
          enabled: true,
          requiresSelfReviewConfirmation: true
        })
      ])
    );
  });

  it("shows finance entry as recorded after finance records cover paid amount", async () => {
    const prisma = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          settlementId: "settlement-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          code: "FK-2026-014",
          status: "paid",
          requestedAmountCents: 5000000n,
          approvedAmountCents: 5000000n,
          paidAmountCents: 5000000n
        })
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          code: "JS-2026-034",
          periodLabel: "2026-06",
          status: "partially_paid"
        })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          versionNo: 1
        })
      },
      paymentTermsVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "terms-version-1",
          versionNo: 1
        })
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([
          { id: "execution-1", amountCents: 5000000n }
        ])
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([
          { id: "finance-1", amountCents: 5000000n }
        ])
      },
      paymentExecutionAllocation: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const service = new PaymentReadService(prisma as never);

    const detail = await service.getDetail("FK-2026-014");

    expect(detail.executionSteps).toContainEqual({
      label: "财务入账",
      status: "已入账",
      owner: "财务部",
      tone: "success"
    });
  });

  it.each([
    {
      name: "without a contract version",
      prisma: {},
      contractVersionId: "",
      rawAsOf: undefined,
      message: "请选择要申请付款的合同版本"
    },
    {
      name: "with an invalid as-of date",
      prisma: {},
      contractVersionId: "contract-version-1",
      rawAsOf: "not-a-date",
      message: "付款申请基准日期格式不正确，请重新选择日期"
    },
    {
      name: "when the contract version cannot be found",
      prisma: {
        contractVersion: {
          findUnique: jest.fn().mockResolvedValue(null)
        }
      },
      contractVersionId: "contract-version-1",
      rawAsOf: "2026-07-20T00:00:00.000Z",
      message: "未找到合同版本，请刷新合同台账后重试"
    },
    {
      name: "when the contract version is not effective",
      prisma: {
        contractVersion: {
          findUnique: jest.fn().mockResolvedValue({
            id: "contract-version-1",
            contractId: "contract-1",
            status: "approval_pending"
          })
        }
      },
      contractVersionId: "contract-version-1",
      rawAsOf: "2026-07-20T00:00:00.000Z",
      message: "当前合同版本尚未归档生效，不能发起付款申请"
    },
    {
      name: "when the linked contract cannot be found",
      prisma: {
        contractVersion: {
          findUnique: jest.fn().mockResolvedValue({
            id: "contract-version-1",
            contractId: "contract-1",
            status: "effective"
          })
        },
        contract: {
          findUnique: jest.fn().mockResolvedValue(null)
        }
      },
      contractVersionId: "contract-version-1",
      rawAsOf: "2026-07-20T00:00:00.000Z",
      message: "未找到关联合同，请先核对合同台账"
    }
  ])(
    "rejects contract payment application preview $name",
    async ({ prisma, contractVersionId, rawAsOf, message }) => {
      const service = new PaymentReadService(prisma as never);

      await expect(service.getContractApplication(contractVersionId, rawAsOf)).rejects.toThrow(
        message
      );
    }
  );

  it("builds a contract-level payment application preview from all effective settlements", async () => {
    const prisma = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          versionNo: 1,
          status: "effective",
          amountCents: 1_000_000n,
          effectiveAt: new Date("2026-06-01T00:00:00.000Z")
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-version-1",
            amountCents: 1_000_000n
          }
        ])
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          code: "HT-2026-009",
          name: "幕墙分包合同",
          projectId: "project-1",
          contractTypeKey: "generic_contract"
        })
      },
      project: {
        findUnique: jest.fn().mockResolvedValue({
          id: "project-1",
          name: "总部综合楼"
        })
      },
      paymentTermsVersion: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "terms-version-1"
          }
        ])
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-due",
            code: "JS-2026-031",
            periodLabel: "2026-06",
            status: "effective",
            amountCents: 100_000n,
            paidAmountCents: 10_000n,
            contractVersionId: "contract-version-1",
            paymentTermsVersionId: "terms-version-1",
            isFinal: false,
            createdAt: new Date("2026-06-10T00:00:00.000Z"),
            updatedAt: new Date("2026-06-10T00:00:00.000Z")
          },
          {
            id: "settlement-not-due",
            code: "JS-2026-032",
            periodLabel: "2026-07",
            status: "effective",
            amountCents: 50_000n,
            paidAmountCents: 0n,
            contractVersionId: "contract-version-1",
            paymentTermsVersionId: "terms-version-1",
            isFinal: false,
            createdAt: new Date("2026-07-10T00:00:00.000Z"),
            updatedAt: new Date("2026-07-10T00:00:00.000Z")
          }
        ])
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([
          {
            settlementId: "settlement-due",
            confirmedAt: new Date("2026-06-01T00:00:00.000Z")
          },
          {
            settlementId: "settlement-not-due",
            confirmedAt: new Date("2026-07-10T00:00:00.000Z")
          }
        ])
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "stage-progress",
            paymentTermsVersionId: "terms-version-1",
            name: "进度款",
            stageType: "progress",
            basis: "current_settlement",
            ratioBps: 8000,
            fixedAmountCents: null,
            triggerAnchor: "settlement_effective",
            triggerEvent: "结算归档确认",
            dueDays: 30,
            advanceDeductionMode: "none",
            advanceDeductionRatioBps: null,
            advanceDeductionStartRatioBps: null,
            requiresInvoice: true
          },
          {
            id: "stage-advance",
            paymentTermsVersionId: "terms-version-1",
            name: "预付款",
            stageType: "advance",
            basis: "contract_amount",
            ratioBps: 1000,
            fixedAmountCents: null,
            triggerAnchor: "contract_effective",
            triggerEvent: "合同生效",
            dueDays: 0,
            advanceDeductionMode: "per_settlement_ratio",
            advanceDeductionRatioBps: 2000,
            advanceDeductionStartRatioBps: null,
            requiresInvoice: false
          }
        ])
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            settlementId: "settlement-due",
            sourceType: "settlement",
            paymentTermsVersionId: "terms-version-1",
            status: "approved_pending_payment",
            requestedAmountCents: 30_000n,
            approvedAmountCents: 30_000n,
            paidAmountCents: 0n
          },
          {
            settlementId: null,
            sourceType: "contract_advance",
            paymentTermsVersionId: "terms-version-1",
            status: "paid",
            requestedAmountCents: 50_000n,
            approvedAmountCents: 50_000n,
            paidAmountCents: 50_000n
          }
        ])
      },
      projectProxyPayment: {
        findMany: jest.fn().mockResolvedValue([
          {
            amountCents: 5_000n
          }
        ])
      }
    };
    const service = new PaymentReadService(prisma as never);

    const preview = await service.getContractApplication(
      "contract-version-1",
      "2026-07-20T00:00:00.000Z"
    );

    expect(prisma.settlement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ contractId: "contract-1" })
      })
    );
    expect(preview.contract).toEqual({
      contractId: "contract-1",
      contractVersionId: "contract-version-1",
      contractNo: "HT-2026-009",
      contractName: "幕墙分包合同",
      contractVersion: "合同 v1",
      contractTypeKey: "generic_contract",
      projectId: "project-1",
      projectName: "总部综合楼"
    });
    expect(preview.capacity).toMatchObject({
      cumulativeEffectiveSettlementCents: "150000",
      duePayableCents: "80000",
      occupiedCents: "45000",
      proxyPaidCents: "5000",
      advanceDeductionCents: "20000",
      maxRequestableCents: "15000"
    });
    expect(preview.genericContractCapacity).toEqual({
      contractAmountCents: "1000000",
      contractOccupiedCents: "85000",
      contractRemainingCents: "915000"
    });
    expect(preview.capacityExplanation).toEqual([
      expect.objectContaining({ label: "合同金额", amountCents: "1000000" }),
      expect.objectContaining({ label: "扣合同已占用金额", amountCents: "85000" }),
      expect.objectContaining({ label: "合同当前剩余额度", amountCents: "915000" })
    ]);
    expect(prisma.projectProxyPayment.findMany).toHaveBeenCalledWith({
      where: {
        voidedAt: null,
        OR: [
          { contractId: "contract-1" },
          { settlementId: { in: ["settlement-due", "settlement-not-due"] } }
        ]
      },
      select: { amountCents: true }
    });
    expect(preview.advanceDeduction).toMatchObject({
      paidAdvanceCents: "50000",
      currentDeductionCents: "20000",
      remainingAdvanceToDeductCents: "30000"
    });
    expect(preview.sections.map((section) => section.type)).toEqual(["advance", "progress"]);
    expect(prisma.paymentTermsStage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ requiresInvoice: true })
      })
    );
    expect(preview.sections[1]).toMatchObject({
      type: "progress",
      title: "进度款"
    });
    expect(preview.sections[1].rows).toEqual([
      expect.objectContaining({
        source: "JS-2026-031 · 2026-06",
        currentSettlementAmountCents: "100000",
        cumulativeBeforeAmountCents: "0",
        cumulativeAfterAmountCents: "100000",
        expectedPayableAt: "2026-07-01",
        invoiceRequirement: "需提供发票",
        isDue: true,
        includableAmountCents: "80000"
      }),
      expect.objectContaining({
        source: "JS-2026-032 · 2026-07",
        cumulativeBeforeAmountCents: "100000",
        cumulativeAfterAmountCents: "150000",
        expectedPayableAt: "2026-08-09",
        invoiceRequirement: "需提供发票",
        isDue: false,
        includableAmountCents: "0"
      })
    ]);
    expect(preview.formula).toContain("当前生效合同金额 - 合同已占用金额");
  });

  it("builds contract payment application preview with historical takeover balance breakdown", async () => {
    const confirmedAt = new Date("2026-07-01T00:00:00.000Z");
    const prisma = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          versionNo: 1,
          status: "effective",
          amountCents: BigInt(1_000_000),
          effectiveAt: new Date("2026-06-01T00:00:00.000Z")
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-version-1",
            amountCents: BigInt(1_000_000)
          }
        ])
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1",
          code: "HT-HIS-001",
          temporaryCode: null,
          name: "历史幕墙分包合同",
          contractTypeKey: "generic_contract"
        })
      },
      project: {
        findUnique: jest.fn().mockResolvedValue({
          id: "project-1",
          name: "总部综合楼"
        })
      },
      paymentTermsVersion: {
        findMany: jest.fn().mockResolvedValue([{ id: "terms-version-1" }])
      },
      contractTakeover: {
        findFirst: jest.fn().mockResolvedValue({
          id: "takeover-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          takeoverStatus: "confirmed",
          historicalBalanceConfirmedAt: confirmedAt,
          historicalSettledCents: BigInt(200_000),
          historicalApprovalPendingPaymentCents: BigInt(0),
          historicalApprovedPendingPaymentCents: BigInt(20_000),
          historicalPaidCents: BigInt(50_000),
          historicalProxyPaidCents: BigInt(10_000),
          historicalAdvancePaidCents: BigInt(40_000),
          historicalAdvanceDeductedCents: BigInt(10_000),
          historicalRetentionWithheldCents: BigInt(12_000),
          historicalRetentionReleasedCents: BigInt(5_000),
          otherConfirmedOccupancyCents: BigInt(0)
        })
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-1",
            code: "JS-2026-041",
            periodLabel: "2026-07",
            status: "effective",
            amountCents: 100_000n,
            paidAmountCents: 10_000n,
            contractVersionId: "contract-version-1",
            paymentTermsVersionId: "terms-version-1",
            isFinal: false,
            createdAt: new Date("2026-07-01T00:00:00.000Z")
          }
        ])
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([
          {
            settlementId: "settlement-1",
            confirmedAt: new Date("2026-07-01T00:00:00.000Z")
          }
        ])
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "stage-progress",
            paymentTermsVersionId: "terms-version-1",
            name: "进度款",
            stageType: "progress",
            basis: "current_settlement",
            ratioBps: 8000,
            fixedAmountCents: null,
            triggerAnchor: "settlement_effective",
            triggerEvent: "结算归档确认",
            dueDays: 0,
            advanceDeductionMode: "none",
            advanceDeductionRatioBps: null,
            advanceDeductionStartRatioBps: null
          },
          {
            id: "stage-advance",
            paymentTermsVersionId: "terms-version-1",
            name: "预付款",
            stageType: "advance",
            basis: "contract_amount",
            ratioBps: 1000,
            fixedAmountCents: null,
            triggerAnchor: "contract_effective",
            triggerEvent: "合同生效",
            dueDays: 0,
            advanceDeductionMode: "per_settlement_ratio",
            advanceDeductionRatioBps: 2000,
            advanceDeductionStartRatioBps: null
          }
        ])
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            settlementId: "settlement-1",
            sourceType: "settlement",
            paymentTermsVersionId: "terms-version-1",
            status: "approved_pending_payment",
            requestedAmountCents: 10_000n,
            approvedAmountCents: 10_000n,
            paidAmountCents: 0n
          }
        ])
      },
      projectProxyPayment: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const service = new PaymentReadService(prisma as never);

    const preview = await service.getContractApplication(
      "contract-version-1",
      "2026-07-20T00:00:00.000Z"
    );

    expect(preview.capacity).toMatchObject({
      systemCumulativeEffectiveSettlementCents: "100000",
      historicalSettledCents: "200000",
      cumulativeEffectiveSettlementCents: "300000",
      duePayableCents: "80000",
      actualPaidCents: "10000",
      approvedPendingCents: "10000",
      proxyPaidCents: "0",
      historicalPaidCents: "50000",
      historicalApprovedPendingCents: "20000",
      historicalProxyPaidCents: "10000",
      historicalOccupiedCents: "87000",
      advanceDeductionCents: "10000",
      maxRequestableCents: "0"
    });
    expect(preview.historicalBalance).toEqual({
      settledCents: "200000",
      approvalPendingPaymentCents: "0",
      approvedPendingPaymentCents: "20000",
      paidCents: "50000",
      proxyPaidCents: "10000",
      advancePaidCents: "40000",
      advanceDeductedCents: "10000",
      retentionWithheldCents: "12000",
      retentionReleasedCents: "5000",
      otherConfirmedOccupancyCents: "0"
    });
    expect(preview.advanceDeduction).toMatchObject({
      paidAdvanceCents: "40000",
      systemPaidAdvanceCents: "0",
      historicalAdvancePaidCents: "40000",
      historicalAdvanceDeductedCents: "10000",
      currentDeductionCents: "10000",
      remainingAdvanceToDeductCents: "20000"
    });
    expect(preview.capacityExplanation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "合同金额" }),
        expect.objectContaining({ label: "扣合同已占用金额" }),
        expect.objectContaining({ label: "合同当前剩余额度" })
      ])
    );
  });

  it("reads payment capacity when a historical contract change baseline is missing", async () => {
    const confirmedAt = new Date("2026-07-01T00:00:00.000Z");
    const prisma = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          versionNo: 1,
          status: "effective",
          changeType: "historical_takeover",
          originalBaseAmountCents: null,
          amountCents: BigInt(100_000),
          effectiveAt: new Date("2026-06-01T00:00:00.000Z")
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-version-1",
            amountCents: BigInt(100_000)
          }
        ])
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1",
          code: "HT-HIS-002",
          temporaryCode: null,
          name: "历史期初付款合同",
          contractTypeKey: "generic_contract"
        })
      },
      project: {
        findUnique: jest.fn().mockResolvedValue({
          id: "project-1",
          name: "总部综合楼"
        })
      },
      paymentTermsVersion: {
        findMany: jest.fn().mockResolvedValue([{ id: "terms-version-1" }])
      },
      contractTakeover: {
        findFirst: jest.fn().mockResolvedValue({
          id: "takeover-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          takeoverStatus: "confirmed",
          historicalBalanceConfirmedAt: confirmedAt,
          historicalSettledCents: BigInt(100_000),
          historicalApprovalPendingPaymentCents: BigInt(0),
          historicalApprovedPendingPaymentCents: BigInt(10_000),
          historicalPaidCents: BigInt(40_000),
          historicalProxyPaidCents: BigInt(0),
          historicalAdvancePaidCents: BigInt(0),
          historicalAdvanceDeductedCents: BigInt(0),
          historicalRetentionWithheldCents: BigInt(0),
          historicalRetentionReleasedCents: BigInt(0),
          otherConfirmedOccupancyCents: BigInt(5_000)
        })
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-takeover-initial",
            code: "HT-HIS-002-期初结算",
            periodLabel: "历史期初",
            status: "effective",
            amountCents: 100_000n,
            paidAmountCents: 40_000n,
            contractVersionId: "contract-version-1",
            paymentTermsVersionId: "terms-version-1",
            isFinal: false,
            sourceType: "historical_takeover",
            sourceTakeoverId: "takeover-1",
            createdAt: new Date("2026-07-01T00:00:00.000Z")
          }
        ])
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "stage-progress",
            paymentTermsVersionId: "terms-version-1",
            name: "结算款",
            stageType: "progress",
            basis: "current_settlement",
            ratioBps: 10000,
            fixedAmountCents: null,
            triggerAnchor: "settlement_effective",
            triggerEvent: "结算归档确认",
            dueDays: 0,
            advanceDeductionMode: "none",
            advanceDeductionRatioBps: null,
            advanceDeductionStartRatioBps: null
          }
        ])
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectProxyPayment: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const service = new PaymentReadService(prisma as never);

    const preview = await service.getContractApplication(
      "contract-version-1",
      "2026-07-20T00:00:00.000Z"
    );

    expect(preview.capacity).toMatchObject({
      duePayableCents: "100000",
      actualPaidCents: "40000",
      approvedPendingCents: "0",
      historicalPaidCents: "0",
      historicalApprovedPendingCents: "10000",
      historicalOtherConfirmedOccupancyCents: "5000",
      maxRequestableCents: "45000"
    });
    expect(preview.capacityExplanation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "合同金额" }),
        expect.objectContaining({ label: "扣合同已占用金额" }),
        expect.objectContaining({ label: "合同当前剩余额度", tone: "success" })
      ])
    );
    expect(preview.capacityExplanation).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          note: "含历史接管已付款"
        })
      ])
    );
  });

  it.each([
    ["冻结候选调岗后", "finance-director-1", [], true],
    ["同岗位非冻结候选", "finance-director-2", ["finance_director"], false]
  ] as const)("受治理付款节点%s保持冻结人员口径", async (_label, actorUserId, roleKeys, expected) => {
    const prisma = {
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          applicantUserId: "applicant-1",
          frozenNodes: [{
            roleKeys: ["finance_director"],
            candidateUserIdsByRole: { finance_director: ["finance-director-1"] },
            candidateUserIds: ["finance-director-1"]
          }],
          currentNodeIndex: 0
        })
      },
      approvalDelegation: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const service = new PaymentReadService(prisma as never, {
      effectiveRoleKeys: jest.fn().mockResolvedValue([])
    } as never) as unknown as {
      canReviewCurrentApproval(
        businessType: string,
        businessId: string,
        projectId: string,
        roleKeys: string[],
        actorUserId: string
      ): Promise<{ canAct: boolean; canReview: boolean }>;
    };

    const access = await service.canReviewCurrentApproval(
      "payment_request",
      "payment-1",
      "project-1",
      [...roleKeys],
      actorUserId
    );

    expect(access.canAct).toBe(expected);
    expect(access.canReview).toBe(expected);
  });
});
