# 2026-07-13 COS/CAM 只读核验与历史接管上传故障结论

## 核验边界

- 用户仅授权只读检查腾讯云 COS/CAM 当前策略。
- 本次没有创建、修改或删除 COS 对象，没有修改桶权限、CAM 用户、密钥或策略，也没有修改、推送或部署功能代码。
- 生产密钥只在服务器内存中用于签名只读 `GET` 请求，SecretKey 未输出；SecretId 仅以归属一致性核对，不写入本报告。

## 生产配置与云端事实

- 生产 API 使用 `FILE_STORAGE_DRIVER=cos`。
- 存储桶为 `jiangkong-prod-files-1438687719`，地域为 `ap-chengdu`。
- 桶访问权限为私有读写；用户 ACL 仅主账号完全控制，没有公共授权。
- 桶 Policy 为空，防盗链关闭，没有发现额外显式拒绝条件。
- 生产 SecretId 属于启用的编程访问子账号 `jiangkong-prod-api-cos`；该密钥创建于 2026-07-07，腾讯云访问记录精确包含 2026-07-13 10:03:24 的 `cos:PutObject`。
- 子账号直接关联自定义策略 `JiangKongProdCosUploadsRW`，没有用户组和权限边界。策略当前版本允许：

```json
{
  "statement": [
    {
      "action": [
        "name/cos:PutObject",
        "name/cos:GetObject"
      ],
      "effect": "allow",
      "resource": [
        "qcs::cos:ap-chengdu:uid/1438687719:jiangkong-prod-files-1438687719/uploads/*"
      ]
    }
  ],
  "version": "2.0"
}
```

- 上述 action 和 resource 形式与腾讯云官方 COS 用户策略及 PUT Object 文档一致。
- CAM 鉴权模拟器对该策略和其自身资源显示“拒绝，没有匹配到策略”，但真实 COS 对象 API 的纯英文路径请求已成功通过身份和权限检查并到达对象不存在判断。因此最终以真实对象 API 响应为准，不把模拟器结果单独当作权限失效证据。

## 无写入 A/B 证据

所有请求均访问 `uploads/*` 下保证不存在的对象，只执行签名 `GET`，不会创建对象。

| 请求 | 签名时的 canonical path | COS 结果 | 结论 |
| --- | --- | --- | --- |
| 纯英文对象名 | 当前实现的 pathname | `404 NoSuchKey` | 密钥、桶、地域、网络和 GetObject 授权正常 |
| 中文对象名 | 当前实现的百分号编码 pathname | `403 SignatureDoesNotMatch` | 当前自写签名对中文路径计算错误 |
| 同一中文对象名 | 未编码的原始中文 pathname | `404 NoSuchKey` | 仅修正 canonical path 即可通过签名和权限校验 |

腾讯云官方请求签名文档建议优先使用 SDK 生成签名，并提醒实际请求路径不要重复 URL 编码。当前代码在 `PrivateFileStorage.cosRequest` 中先以 `encodeURI` 生成 pathname，又把该百分号编码 pathname 直接传给 `cosAuthorization` 参与 HttpString 计算；`FileService.safeFileName` 则明确保留中文字符。两者组合使中文合同文件名稳定触发 `SignatureDoesNotMatch`。

现有失败分支丢弃 COS 响应状态、错误码和 RequestId，只抛通用中文 500；因此 10:03:24 的历史失败无法从旧日志恢复原始文件名和真实 COS 错误体。这是独立的可观测性缺陷。

## 最小修复范围

1. 分离请求 URL path 与签名 canonical path：实际 URL 继续安全编码，签名 HttpString 使用 COS 要求的原始路径；更稳妥的长期方案是改用腾讯云官方 SDK，停止维护手写签名算法。
2. 为纯英文、中文、空格/括号经文件名清洗后的对象键补充 GET、PUT、DELETE 签名单测，至少保证中文路径不会再次退化。
3. 解析 COS 错误 XML，并仅在服务端记录脱敏后的 HTTP 状态、COS Code、RequestId 和操作类型；不记录 SecretId、SecretKey、Authorization 或文件内容。
4. CAM 策略仅补 `name/cos:DeleteObject`，资源仍限定为当前桶的 `uploads/*`。该权限供数据库登记失败补偿、文件替换和删除链使用，不扩大到列桶、桶配置或其他前缀。
5. 发布后使用真实接管草稿和中文文件名复验：上传对象成功、FileObject 登记、接管证据绑定、授权下载、审计记录和失败补偿。

## 当前状态

只读诊断已完成；代码修复、CAM 权限修改、生产发布和真实文件 UAT 均未执行，需用户分别授权。

## 官方依据

- [腾讯云 COS：请求签名](https://cloud.tencent.com/document/product/436/7778)
- [腾讯云 COS：用户策略](https://cloud.tencent.com/document/product/436/68280)
- [腾讯云 COS：PUT Object](https://cloud.tencent.com/document/product/436/7749)
