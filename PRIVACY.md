# 隐私说明 / Privacy

网页媒体助手不包含遥测、广告或自建服务器上传逻辑。扩展需要访问网页内容，以发现媒体元素、观察媒体请求并解析悬停目标；设置保存在 Firefox 的扩展存储中。

媒体检索结果可能包含当前页面请求的媒体网址并暂存在本地扩展存储。图片预览加载页面已有图片、背景图或明确的图片链接；用户配置的预览规则还可能在相同图片域名上依次请求 URL 模板生成的候选图片。规则只保存在本地，不执行脚本，也不会请求额外解析页面或第三方解析接口。只有用户主动下载时才会调用 Firefox 下载功能。扩展不会通过旧版 Imagus 的“发送图片”服务提交图片网址。

Web Media Assistant contains no telemetry, advertising, or project-operated upload endpoint. It accesses page content to control media, observe media requests, and resolve hover targets. Settings are stored in Firefox extension storage.

Media discovery may temporarily store media URLs requested by the current page. Image preview loads images, backgrounds, or explicit image links exposed by the page; user-configured preview rules may also try candidate images generated from URL templates on the same image host. Rules are stored locally, run no scripts, and fetch no extra resolver pages or third-party resolver endpoints. Firefox downloads are created only after a user action. The legacy Imagus “send image” services are not included.
