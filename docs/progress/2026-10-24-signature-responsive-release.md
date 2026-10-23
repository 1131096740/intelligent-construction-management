# 手机全屏签名与响应式适配发布记录

本批已于北京时间2026-10-24 01:57完成前端静态发布，01:59:17完成本轮验收。人事主控已明确完成上线并释放窗口后，本批才继续整合、合并与发布。仅更新Web，保留已上线人事功能和原工作目录的其他改动。

## 准确版本

| 对象 | 准确版本或摘要 |
| --- | --- |
| 冻结Web源 | `833dd0c7e748777514e580233a023de26ea4bafc` |
| PR #371合并main | `1d0745b9cc60057ee7439ba7defed14726312552`，与Web源树完全一致 |
| 保留的实际API runtime | `733c9bae916001c3436f6110a9a4b2e0ae04e175` |
| 服务器保留checkout | `6bf7820c0d925e5804ad7d03ae8b983a9220b5e3`，仅为旧checkout，不是实际API运行版本 |
| Web manifest SHA256 | `ed2e6a9df2183e9cec6901abe1972fe35768d48b7106731ba109ea81e87ba6bb` |
| 新首页SHA256 | `ec5fed3a81c77699f1bf91ac2bb2771bb35f7c16a35f4114585cd52b1664c914` |
| 旧首页SHA256 | `601f734fd515b03aca300a19e8da2ae306c31913a554457e96f0b2ada01db341` |
| 封存包SHA256 | `a97ec2f9110781a3f858b1274dedd2362d65a4cc28bbdac951d55425ca479db6` |

文档收口提交不作为新的运行版本，不再次部署。禁止使用服务器旧checkout重新构建或重启API。

## 范围与验证

- 用户已完成手机预览并确认签名效果。实现锁定竖屏时全屏横向书写、握持方向提示、大画布、同向预览及保存失败保留笔迹重试，扫码入口独立展示；同步适配导航、台账、详情、文档预览及窄屏上传区域。
- 人事上线后从文档主线`ed430237c94cca1b6189fd98392aa3b5f6feccc8`重新整合，范围为31个Web路径、3个派生清单/文档及PROGRESS共35路径；人事79个非文档文件逐项blob保留。API、Schema、迁移、权限、工作流和依赖未改。
- 新候选Web237套/2218项、Web/E2E类型、lint零错误、UI规则及Node20.20.2构建通过。签名与响应式104/104、接管64/64，各一次运行，零失败、跳过、重试；源码和264个dist文件前后不变。原本地代理日志计数36/8保留，不据此声称零网络异常。
- [候选CI39994525099](https://github.com/1131096740/intelligent-construction-management/actions/runs/39994525099)准确绑定`833dd0c7…`，[主线CI39997315882](https://github.com/1131096740/intelligent-construction-management/actions/runs/39997315882)准确绑定`1d0745b9…`，均终态26/26任务成功。独立源码范围与人事保留复审无阻断；旧87033/70c候选结果未替代新资格。
- 临时发布器130项、打包/公开检查42项离线准备验证通过；这些准备测试与生产验收分别记录。

## 实际执行与验收

1. 发布前再次只读采集生产基线，与封存原件精确一致。实际API由人事安装收据、运行摘要、进程和依赖目标共同绑定到733c9bae；旧checkout单独登记。健康和数据库就绪正常。
2. 所有线上操作使用既有`/srv/jiangkong/.deploy.lock`；发布前保存并验证全部旧静态文件快照。仅增量写入新资源后原子切换首页，没有API部署/重启、迁移、数据库恢复或真实业务写入。
3. 新264个文件逐项hash匹配，旧非首页263个文件全部保留；最终Web精确417文件并集，无缺失或额外路径。旧快照位于`/srv/jiangkong/releases/signature-responsive-20261023/833dd0c7e748777514e580233a023de26ea4bafc`，快照摘要核验通过，本轮未回退。
4. 公开HTTPS7项检查通过：新首页及入口JS/CSS的状态、MIME和hash正确，旧入口JS/CSS继续返回原hash，`/api/health`正常、`/api/health/readiness`为ready且database为ok。
5. Chromium/WebKit各手机390×844、笔记本1366×768，四个公开登录页面检查通过；每例页面错误、静态失败和被阻断请求均为0。截图确认表单、按钮和备案页脚完整可见，无明显裁切错乱。
6. 发布后实际API runtime、进程PID/启动标识、cwd/入口、模块目标、2055个构建文件及282个Prisma文件指纹与发布前严格相同。独立本地JSON验收再次确认API保持及Web并集精确一致。
7. 原工作目录52项保护文件逐项摘要不变、索引为空；发布候选与文档均在独立目录处理。

## 收据与边界

私有执行收据统一保存在`/private/tmp/jgzg-signature-responsive-production-20261024-833dd0c7/`，包括`publication-plan.json`、`stage-receipt.json`、`stage-verify.json`、`publish.json`、`before.json`、`prepublish-fresh.json`、`after.json`及汇总`acceptance-receipt.json`。

| 证据 | SHA256 |
| --- | --- |
| 发布前API/Web基线原件 | `b23d66c0a264abc713c1c421286620adc3de74e24775fdb22c6bac72a390d91e` |
| 实际静态发布收据 | `2cd87806532ea2fe1d27424741767f5c2ef80426f225e0a4faa75d0307612dc8` |
| 发布后API/Web原件 | `daa8a21ef33711b90b93e60acc7019412a11e1f322fb5f30a4552042ef1ccd9d` |
| 独立验收收据 | `a7d8960983613bad31667f961a1ed64becc6f42e1a6b806e576ed213c794ad19` |
| 公开HTTPS收据 | `923f252434a7f8223c62152ce09852273f821857e11995a88a50d42a567abc53` |
| 四端公开UI收据 | `31d114f46a51ae0fb67cdab515978b3901b1b6584b84e28580ceaff1ace6f151` |

公开检查原件分别位于`/private/tmp/jgzg-signature-responsive-public-833dd0c7-20261024/`及`/private/tmp/jgzg-signature-responsive-public-ui-833dd0c7-20261024/`；独立验收为`/private/tmp/jgzg-signature-responsive-independent-acceptance-833dd0c7-20261023T175820Z.json`。

本轮线上UI验收仅公开未登录页面，不代替真实员工签名/保存或人事业务验收；签名业务断言来自新冻结候选的本地104项和此前用户真机预览。没有代办真实签名、审批、付款或员工业务，没有读取比较业务行或回滚合法业务写入。#348历史根因阻断保持，见[人事发布记录](2026-10-23-lean-personnel-v2-release.md)。
