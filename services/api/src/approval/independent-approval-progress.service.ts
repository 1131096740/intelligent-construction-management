import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { resolveEffectiveRoleKeys, type RoleKey } from '@jiangkong/shared-domain';
import { createHash } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { SpotProcurementPilotService } from '../spot-procurement/spot-procurement-pilot.service';
import { ApprovalSmsService } from './approval-sms.service';
import { SOURCES, INDEPENDENT_REVIEW_LOCK_TABLES, type IndependentReviewNode, type IndependentReviewSubject } from './independent-approval-progress.sources';

type Db = Prisma.TransactionClient;
const ID_PREFIX = 'independent:';
const CURSOR_PREFIX = 'independent-cursor:';
const REMINDER_BUSINESS = 'approval_progress_reminder';
const ACTION = { request: 'approval_progress.sms_request', recipient: 'approval_progress.sms_recipient_result', result: 'approval_progress.sms_result' } as const;
const COOLDOWN_MS = 10 * 60 * 1000;
const SCAN_LIMIT = 200;
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const unique = (items: string[]) => [...new Set(items.filter(Boolean))];

@Injectable()
export class IndependentApprovalProgressService {
  constructor(private readonly prisma: PrismaService, private readonly sms: ApprovalSmsService, @Optional() private readonly pilot?: SpotProcurementPilotService) {}

  supports(kind: string) { return SOURCES.some(source => source.kind === kind); }
  isIndependentId(id: string) { return id.startsWith(ID_PREFIX); }

  async list(actorId: string, cursor?: string, kind?: string, businessId?: string, limit = 30) {
    const items: Awaited<ReturnType<IndependentApprovalProgressService['detail']>>[] = [];
    const directory = await this.directory(this.prisma);
    this.requireActive(directory, actorId);
    if (kind && !this.supports(kind)) throw new BadRequestException('审核类型不存在');
    if (kind && businessId) {
      try { items.push(this.project(await this.context(this.prisma, `${ID_PREFIX}${kind}:${businessId}`, actorId, directory))); }
      catch (error) { if (!(error instanceof NotFoundException)) throw error; }
      return { items, nextCursor: null };
    }
    const sources = kind ? SOURCES.filter(source => source.kind === kind) : SOURCES;
    const start = this.readCursor(cursor);
    let index = start ? sources.findIndex(source => source.kind === start.kind) : 0;
    if (index < 0) throw new BadRequestException('审核列表位置已失效，请重新加载');
    let after = start?.after;
    let scanned = 0;
    const pageSize = Math.max(1, Math.min(30, Number.isFinite(limit) ? Math.floor(limit) : 30));
    const continuation = () => index < sources.length ? this.cursor(sources[index].kind, after) : null;
    while (index < sources.length && scanned < SCAN_LIMIT) {
      const source = sources[index];
      const take = Math.min(100, SCAN_LIMIT - scanned);
      const ids = await source.listIds(this.prisma, after, take);
      for (let row = 0; row < ids.length; row++) {
        after = ids[row]; scanned++;
        try { items.push(this.project(await this.context(this.prisma, `${ID_PREFIX}${source.kind}:${after}`, actorId, directory))); }
        catch (error) { if (!(error instanceof NotFoundException)) throw error; }
        if (items.length >= pageSize) {
          if (row === ids.length - 1 && ids.length < take) { index++; after = undefined; }
          return { items, nextCursor: continuation() };
        }
      }
      if (ids.length < take) { index++; after = undefined; }
    }
    return { items, nextCursor: continuation() };
  }

  async detail(id: string, actorId: string) { return this.project(await this.context(this.prisma, id, actorId)); }

  async remind(id: string, actorId: string, requestId: string, expectedToken: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw new BadRequestException('催办请求无效，请刷新后重试');
    const reservation = await this.prisma.$transaction(async tx => {
      const context = await this.lockedContext(tx, id, actorId);
      const existing = await tx.auditLog.findUnique({ where: { id: requestId } });
      if (existing) {
        if (existing.businessType !== REMINDER_BUSINESS || existing.businessId !== id || existing.actorUserId !== actorId || existing.action !== ACTION.request) throw new ConflictException('催办请求已被使用，请刷新后重试');
        return null;
      }
      const progress = this.project(context);
      if (expectedToken !== progress.reminderToken) throw new ConflictException('审核进度或待审核人已变化，请刷新后重新确认催办对象');
      if (!progress.canRemind) throw new ConflictException(progress.reminderUnavailableReason ?? '当前不能催办');
      const recipientIds = context.pendingIds;
      await tx.auditLog.create({ data: { id: requestId, actorUserId: actorId, businessType: REMINDER_BUSINESS, businessId: id, action: ACTION.request, metadata: { recipientIds, reminderToken: progress.reminderToken } } });
      return { recipientIds, reminderToken: progress.reminderToken };
    }, { maxWait: 15000, timeout: 20000 });
    if (!reservation) return this.detail(id, actorId);
    const results: Array<{ userId: string; status: string; message: string }> = [];
    for (const userId of reservation.recipientIds) {
      const result = await this.prisma.$transaction(async tx => {
        const context = await this.lockedContext(tx, id, actorId);
        const progress = this.project(context);
        let outcome: { status: string; message: string; receipt?: string };
        if (progress.reminderToken !== reservation.reminderToken || !context.pendingIds.includes(userId)) outcome = { status: 'cancelled', message: '审核节点或待审核人已变化，本次未发送' };
        else {
          try { outcome = await this.sms.send(context.directory.byId.get(userId)?.phone ?? '', context.subject.title, progress.currentNodeName, context.subject.businessCode); }
          catch { outcome = { status: 'unknown', message: '短信发送结果待确认，请勿重复发送' }; }
        }
        const result = { userId, status: outcome.status, message: outcome.message };
        await tx.auditLog.create({ data: { actorUserId: actorId, businessType: REMINDER_BUSINESS, businessId: id, action: ACTION.recipient, metadata: { requestId, ...result, ...(outcome.receipt ? { receipt: outcome.receipt } : {}) } } });
        return result;
      }, { maxWait: 15000, timeout: 20000 });
      results.push(result);
    }
    await this.prisma.auditLog.create({ data: { actorUserId: actorId, businessType: REMINDER_BUSINESS, businessId: id, action: ACTION.result, metadata: { requestId, results } } });
    return this.detail(id, actorId);
  }

  private identity(id: string) {
    const match = /^independent:([a-z_]+):(.+)$/.exec(id);
    const source = match ? SOURCES.find(item => item.kind === match[1]) : undefined;
    if (!source || !match) throw new NotFoundException('审核流程不存在或无权查看');
    return { source, rawId: match[2] };
  }

  private cursor(kind: string, after?: string) { return CURSOR_PREFIX + Buffer.from(JSON.stringify({ kind, ...(after ? { after } : {}) })).toString('base64url'); }
  private readCursor(cursor?: string): { kind: string; after?: string } | null {
    if (!cursor) return null;
    if (!cursor.startsWith(CURSOR_PREFIX) || cursor.length > 2048) throw new BadRequestException('审核列表位置无效，请重新加载');
    try {
      const value = object(JSON.parse(Buffer.from(cursor.slice(CURSOR_PREFIX.length), 'base64url').toString()));
      if (typeof value.kind !== 'string' || !this.supports(value.kind) || (value.after !== undefined && typeof value.after !== 'string')) throw new Error('审核列表位置无效');
      return { kind: value.kind, after: value.after as string | undefined };
    } catch { throw new BadRequestException('审核列表位置无效，请重新加载'); }
  }

  private async directory(db: Db) {
    const [users, positions, assignments, members] = await Promise.all([
      db.user.findMany({ select: { id: true, name: true, phone: true, isActive: true } }),
      db.position.findMany({ select: { id: true, key: true } }),
      db.userPosition.findMany({ select: { userId: true, projectId: true, positionId: true } }),
      db.projectMember.findMany({ select: { userId: true, projectId: true, positionKey: true } })
    ]);
    const positionKeys = new Map(positions.map(position => [position.id, position.key]));
    const rolesByUser = new Map<string, { global: Set<string>; projects: Map<string, Set<string>> }>();
    const addRole = (userId: string, role: string | undefined, projectId: string | null) => {
      if (!role) return;
      const roles = rolesByUser.get(userId) ?? { global: new Set<string>(), projects: new Map<string, Set<string>>() };
      if (projectId === null) roles.global.add(role);
      else {
        const projectRoles = roles.projects.get(projectId) ?? new Set<string>();
        projectRoles.add(role); roles.projects.set(projectId, projectRoles);
      }
      rolesByUser.set(userId, roles);
    };
    for (const assignment of assignments) addRole(assignment.userId, positionKeys.get(assignment.positionId), assignment.projectId);
    for (const member of members) addRole(member.userId, member.positionKey, member.projectId);
    return { users, byId: new Map(users.map(user => [user.id, user])), rolesByUser };
  }
  private requireActive(directory: Awaited<ReturnType<IndependentApprovalProgressService['directory']>>, actorId: string) {
    if (!directory.byId.get(actorId)?.isActive) throw new NotFoundException('审核流程不存在或无权查看');
  }

  private async context(db: Db, id: string, actorId: string, suppliedDirectory?: Awaited<ReturnType<IndependentApprovalProgressService['directory']>>, suppliedSubject?: IndependentReviewSubject) {
    const { source, rawId } = this.identity(id);
    const subject = suppliedSubject ?? await source.load(db, rawId);
    if (!subject || subject.kind !== source.kind || subject.id !== rawId) throw new NotFoundException('审核流程不存在或无权查看');
    const directory = suppliedDirectory ?? await this.directory(db);
    this.requireActive(directory, actorId);
    const project = subject.projectId ? await db.project.findUnique({ where: { id: subject.projectId }, select: { name: true, isActive: true } }) : null;
    const projectBlocked = Boolean(subject.requiresActiveProject && subject.projectId && !project?.isActive);
    const roleMatches = (node: IndependentReviewNode, userId: string) => {
      const roles = directory.rolesByUser.get(userId);
      const projectRoles = subject.projectId ? roles?.projects.get(subject.projectId) : undefined;
      const effectiveRoles = resolveEffectiveRoleKeys([...(roles?.global ?? [])] as RoleKey[], [...(projectRoles ?? [])] as RoleKey[]);
      return node.roleKeys.some(role => node.scope === 'global' ? roles?.global.has(role)
        : node.scope === 'project' ? projectRoles?.has(role) : effectiveRoles.includes(role));
    };
    const nodeIds = subject.nodes.map(node => unique(node.selectedUserIds !== undefined ? node.selectedUserIds : directory.users.filter(user => !projectBlocked && user.isActive && roleMatches(node, user.id) && !node.excludeUserIds?.includes(user.id)).map(user => user.id)));
    const pilotBlocked = ['receipt_review', 'no_invoice', 'invoice_exception', 'abnormal_termination'].includes(subject.kind) && !this.pilot?.isEnabled(subject.projectId);
    const pendingByNode = subject.nodes.map((node, index) => !projectBlocked && !pilotBlocked && subject.status === 'in_progress' && index === subject.currentNodeIndex && node.status === '处理中'
      ? nodeIds[index].filter(userId => directory.byId.get(userId)?.isActive && !node.excludeUserIds?.includes(userId) && (node.roleKeys.length ? roleMatches(node, userId) : node.selectedUserIds !== undefined)) : []);
    const participants = new Set([subject.applicantUserId, ...subject.participantIds, ...subject.history.map(event => event.actorUserId), ...nodeIds.flat()]);
    if (!participants.has(actorId)) throw new NotFoundException('审核流程不存在或无权查看');
    const logs = await db.auditLog.findMany({ where: { businessType: REMINDER_BUSINESS, businessId: id, action: { in: Object.values(ACTION) } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    return { id, subject, directory, nodeIds, pendingByNode, pendingIds: unique(pendingByNode.flat()), logs, project, pilotBlocked, projectBlocked };
  }

  private async lockedContext(db: Db, id: string, actorId: string) {
    const { source, rawId } = this.identity(id);
    const subject = await source.load(db, rawId);
    if (!subject) throw new NotFoundException('审核流程不存在或无权查看');
    const targets = subject.lockTargets;
    const whitelist = new Set<string>(INDEPENDENT_REVIEW_LOCK_TABLES);
    if (!targets.length || targets.some(target => !whitelist.has(target.table) || !target.id)) throw new ConflictException('审核对象暂不可锁定，请刷新后重试');
    const locked = new Set<string>();
    for (const target of targets) {
      const key = `${target.table}:${target.id}`;
      if (locked.has(key)) continue;
      await db.$queryRaw(Prisma.sql`SELECT "id" FROM ${Prisma.raw(`"${target.table}"`)} WHERE "id" = ${target.id} FOR UPDATE`);
      locked.add(key);
    }
    const fresh = await source.load(db, rawId);
    if (!fresh) throw new NotFoundException('审核流程不存在或无权查看');
    if (JSON.stringify(fresh.lockTargets) !== JSON.stringify(targets)) throw new ConflictException('审核对象已变化，请刷新后重新确认');
    return this.context(db, id, actorId, undefined, fresh);
  }

  private project(context: Awaited<ReturnType<IndependentApprovalProgressService['context']>>) {
    const { id, subject, directory, nodeIds, pendingIds, pendingByNode, logs, project, pilotBlocked, projectBlocked } = context;
    const person = (userId: string | null) => ({ id: userId ?? '', name: directory.byId.get(userId ?? '')?.name ?? '历史人员（未记录）' });
    const requests = logs.filter(log => log.action === ACTION.request);
    const last = requests.at(-1);
    const nextRemindAt = last ? new Date(last.createdAt.getTime() + COOLDOWN_MS).toISOString() : null;
    const active = subject.status === 'in_progress';
    const reminderUnavailableReason = !active ? '流程已结束' : projectBlocked ? '项目已停用，暂不能催办' : pilotBlocked ? '该项目尚未启用零采办理，暂不能催办' : !pendingIds.length ? '当前没有有效待审核人' : !this.sms.available() ? '短信服务尚未启用' : nextRemindAt && Date.parse(nextRemindAt) > Date.now() ? '刚刚已催办，请稍后再试' : null;
    return {
      id, businessType: subject.kind, businessId: subject.id, title: subject.title, businessCode: subject.businessCode,
      projectName: project?.name ?? '公司级审核', applicant: !subject.applicantUserId && subject.applicantName ? { id: '', name: subject.applicantName } : person(subject.applicantUserId), status: subject.status,
      createdAt: subject.createdAt.toISOString(), currentNodeIndex: subject.currentNodeIndex,
      currentNodeName: active ? subject.nodes[subject.currentNodeIndex]?.name ?? '待核对审核节点' : '流程已结束',
      nodes: subject.nodes.map((node, index) => ({ name: node.name, mode: node.mode === 'all' ? '会签' : '或签', status: node.status, participants: nodeIds[index].map(person), legacyRoster: node.selectedUserIds === undefined, pending: pendingByNode[index].map(person) })),
      pendingRecipients: pendingIds.map(person), canRemind: reminderUnavailableReason === null, reminderUnavailableReason, nextRemindAt,
      reminderToken: createHash('sha256').update(JSON.stringify([id, subject.status, subject.currentNodeIndex, subject.updatedAt.toISOString(), subject.nodes.map(node => [node.name, node.status]), [...pendingIds].sort()])).digest('hex'),
      history: [
        ...subject.history.map((event, index) => ({ id: `${id}:history:${index}`, actor: person(event.actorUserId), action: event.action, comment: event.comment, createdAt: event.createdAt.toISOString() })),
        ...requests.map(log => ({ id: log.id, actor: person(log.actorUserId), action: '催办', comment: null, createdAt: log.createdAt.toISOString() }))
      ].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      reminders: requests.map(request => {
        const final = logs.find(log => log.action === ACTION.result && object(log.metadata).requestId === request.id);
        const partial = logs.filter(log => log.action === ACTION.recipient && object(log.metadata).requestId === request.id).map(log => object(log.metadata));
        const rows = Array.isArray(object(final?.metadata).results) ? object(final?.metadata).results as unknown[] : partial;
        return { id: request.id, actor: person(request.actorUserId), createdAt: request.createdAt.toISOString(), recipients: strings(object(request.metadata).recipientIds).map(person), pending: !final, results: rows.map(value => { const result = object(value); return { userId: String(result.userId), status: String(result.status), message: String(result.message) }; }) };
      })
    };
  }
}
