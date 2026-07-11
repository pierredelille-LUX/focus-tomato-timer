# 番茄专注钟

一个参考 Alloy Timer 番茄工作法页面重新制作的静态 Web 应用。它保留了工作/休息计时、自动循环、时长设置和任务记录，并增加暂停、跳过、长休息、今日统计、本地持久化、提示音和桌面通知。

运行或暂停计时时，浏览器 tab 标题会显示完整倒计时，tab 图标会显示紧凑剩余时间，切换到其他标签页时也能快速看到当前进度。

## 本地运行

```bash
python3 -m http.server 5173
```

然后打开 `http://localhost:5173/`。

## Google 账号同步

应用支持使用 Google Identity Services 登录。“选择已保存的 Google 账号”按钮会调用浏览器账号选择提示，让用户从当前浏览器可用的 Google 账号中选择一个；下方也保留 Google 官方登录按钮作为回退。登录成功后应用会显示姓名、邮箱和 Google ID，并继续请求 Google Drive `appDataFolder` 权限，用于保存设置和任务记录。这个目录只给本应用使用，用户不会在普通 Drive 文件列表里看到这些数据。

配置步骤：

1. 在 Google Cloud Console 创建或选择项目。
2. 启用 Google Drive API。
3. 配置 OAuth consent screen。
4. 创建 OAuth Client，类型选择 `Web application`。
5. 在 Authorized JavaScript origins 添加：
   - `https://pierredelille-lux.github.io`
   - `http://localhost:5173`
6. 把得到的 Client ID 填到 `config.js`：

```js
window.FOCUS_TIMER_CONFIG = {
  googleClientId: "YOUR_CLIENT_ID.apps.googleusercontent.com",
};
```

请求范围：

- `openid email profile`：读取登录账号基础资料。
- `https://www.googleapis.com/auth/drive.appdata`：在用户自己的 Google Drive 应用数据目录中保存番茄钟记录。

官方文档：

- Google Identity Services token model：https://developers.google.com/identity/oauth2/web/guides/use-token-model
- Google OAuth Web Client ID 设置：https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid
- Google Drive appDataFolder：https://developers.google.com/workspace/drive/api/guides/appdata

## 部署

项目是纯静态文件，可直接用 GitHub Pages 从 `main` 分支根目录发布。

公开测试链接：https://pierredelille-lux.github.io/focus-tomato-timer/
