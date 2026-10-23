/**
 * dsh-boot-sequence — 宿主半侧（故意保持为空）
 *
 * 启动界面是纯浏览器行为：数据流画布、终端日志、进度条全部在
 * lib/client.js 里通过 `shell.overlay` 槽位渲染，不需要任何服务端能力
 * （没有 HTTP 路由、没有工具、没有模型调用）。
 *
 * 这个文件存在的唯一意义：让本包成为一个合法的 Cordis bundle，
 * 使 cordis.patch.yml 里的那一行 `insert` 能解析到入口。
 */

export const name = 'boot-sequence';
export const inject = [];

export function apply() {
  // no-op：一切都在客户端。
}
