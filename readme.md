# koishi-plugin-nqblacklist

[[npm](https://img.shields.io/npm/v/koishi-plugin-nqblacklist?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-nqblacklist)

NQ 旗下的云黑插件，用于查询 QQ 号是否在云端黑名单中，并提供定时推送功能，帮助管理员及时了解群内成员的信用状况。

## 功能概述

- **查云黑命令**：用户可以通过 `/查云黑 <QQ号>` 命令查询指定 QQ 号是否在云端黑名单中。
- **定时推送**：支持定时检查群内成员的黑名单状态，并将结果推送给管理员或群聊。
- **灵活配置**：提供多种配置选项，包括定时任务的时间设置、广播范围等，满足不同场景的需求。
