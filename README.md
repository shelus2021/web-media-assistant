# 媒体助手

[English](README_en.md)

面向桌面端与移动端 Firefox 的网页媒体工具箱。

## 主要功能

- 播放控制：倍速、进度快捷键和页面控制器。
- 图片预览：放大或贴图查看页面中的图片和动图。
- 媒体检索：查找、预览和下载当前页面加载的媒体资源。

三个功能均可独立启用。

## 平台支持

- 桌面端：支持鼠标悬停、右键、拖动和键盘快捷键。
- 移动端：支持 Firefox for Android 142.0 及更高版本。
- 触摸操作：长按预览、轻触关闭、双指贴图；贴图后可拖动、缩放和旋转。
- 播放控制器可整体拖动，移动端默认收起并支持自动收起。
- Android 下载通过扩展保存页面交给浏览器或系统处理。

## 图片预览

图片预览以 Imagus 0.9.8.74 的部分代码为基础，界面、规则管理和交互均已针对本扩展重做。

- 支持 `srcset`、背景图、直接图片链接和大图、长图。
- 旋转接近四个正方向时自动吸附。
- 内置预览规则可查看、启停、排序和扩展。
- 规则不执行脚本，也不会切换到原图片以外的域名。
- 当前不提供视频预览。

## 扩展下载

[从 Firefox 附加组件商店安装](https://addons.mozilla.org/zh-CN/firefox/addon/web-media-assistant/)

## 更新日志

[查看版本更新记录](CHANGELOG.md)

## 预览

| 扩展首页 | 播放控制 | 图片预览 | 媒体检索 |
| --- | --- | --- | --- |
| <img src="screenshots/1.png" alt="扩展首页" width="100%"> | <img src="screenshots/2.png" alt="播放控制" width="100%"> | <img src="screenshots/3.png" alt="图片预览" width="100%"> | <img src="screenshots/4.png" alt="媒体检索" width="100%"> |

## 许可

本项目原创的整合代码、设置界面和 UI 设计采用 MIT License。第三方代码仍使用各自许可，详见 [LICENSE](LICENSE) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。Imagus 相关文件不在 MIT 授权范围内。
