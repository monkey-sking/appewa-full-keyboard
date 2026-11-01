# Appewa Full Keyboard

这是一个用于 Appewa（`app.appewa.com`）课程页和 Roadmap 的 Tampermonkey 用户脚本，补上网站当前缺少的键盘确认、继续和选项导航能力，并提供本地错题记录与可选 AI 复习总结。当前版本：`0.2.0`。

- [GitHub 仓库](https://github.com/monkey-sking/appewa-full-keyboard)
- [一键安装到 Tampermonkey](https://raw.githubusercontent.com/monkey-sking/appewa-full-keyboard/refs/heads/main/appewa-full-keyboard.user.js)

## 安装

1. 安装 Tampermonkey（Chrome 中 Tampermonkey BETA 同样可用）。
2. 打开上方“一键安装到 Tampermonkey”链接。
3. 在安装页确认后点击“安装”。
4. 刷新 Appewa 课程页。右下角出现 `F1 键盘` 小按钮即表示脚本已运行。

也可以通过 Tampermonkey 的“实用工具 → 从 URL 安装”使用：

```text
https://raw.githubusercontent.com/monkey-sking/appewa-full-keyboard/refs/heads/main/appewa-full-keyboard.user.js
```

## 快捷键

| 按键 | 作用 |
| --- | --- |
| `Enter` | 检查、继续、提交当前练习，进入课程完成页的“下一页”，在 Roadmap 继续当前课程，或触发能力值弹层的“开始” |
| `↑` / `↓` / `←` / `→` | 聚焦上一个或下一个选项、词语块 |
| `Space` | 选择当前聚焦的选项（原生按钮和 `div[role]` 均可） |
| `1`–`9` | 直接触发第 N 个可见选项或词语块；课程完成页用 `1`–`5` 评价星级 |
| `A`–`Z` | 连续输入词块文字；例如依次输入 `a`、`m` 选择 `am` 词块 |
| `Home` / `End` | 聚焦第一项 / 最后一项 |
| `Alt+R` | 重播当前可见音频 |
| `Alt+S` | 慢速播放（页面提供时） |
| `Alt+H` | 打开提示（页面提供时） |
| `Alt+M` | 打开或关闭 AI 错题本 |
| `Alt+Enter` | 错题本打开时生成 AI 总结 |
| `F1` | 打开或关闭快捷键帮助 |
| `Esc` | 只关闭脚本面板，不关闭课程 |

输入框内不会拦截按键。字母输入、`Backspace`、`Tab`、`Space` 和文本输入继续使用网站原生行为。

## 错题本与 AI 总结

- 答错后，脚本会从页面的错误反馈中记录题目、你的答案、正确答案和反馈；没有文字媒体时显示占位说明。
- 记录按课程和练习去重。同一次反馈停留时只记一次，关闭反馈后再次答错才会新增记录。
- 错题和上次 AI 总结只保存在当前浏览器的 Tampermonkey 存储中，最多保留 100 道。
- 脚本不会自动调用 AI。只有点击“生成 AI 总结”或在错题本打开时按 `Alt+Enter`，才会发送最近 30 道错题的精简记录。
- 发送内容不包含 Appewa 账号、Cookie 或页面 URL。API Key 同样只保存在本机脚本存储中，不写入本仓库。
- 不配置 AI 接口时，本地错题本仍然可以正常使用。

AI 配置面板支持 OpenAI 兼容的 Chat Completions 接口，例如：

| 服务 | 接口地址示例 | 模型示例 |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1/chat/completions` | `gpt-4.1-mini` |
| DeepSeek | `https://api.deepseek.com/chat/completions` | `deepseek-chat` |
| OpenRouter | `https://openrouter.ai/api/v1/chat/completions` | 服务商页面上的完整模型名 |
| 本机模型 | `http://localhost:11434/v1/chat/completions` | 本机已安装的模型名 |

远程接口必须使用 HTTPS；HTTP 仅允许 `localhost`、`127.0.0.1` 和 `::1`。不同服务可能产生 API 费用，请先确认自己的账户和模型价格。脚本不绕过 Appewa 的体力、会员或付费限制。

## 支持的练习

脚本按 Appewa 的 `data-testid` 工作，覆盖以下渲染器的通用控件：

- 单项选择：`singleChoice`、`chooseIsCorrect`、`chooseMissedLetter`
- 句子和词语组合：`composePhrase`、`composeSentence`、`composeWord`
- 配对：`findPairs`
- 文本内选择：`textWithChooseAnswers`
- 对话：`dialog`
- 拼写、填空等使用站点字母键盘的练习
- 讲解、反馈和验证弹层中的检查 / 继续按钮
- 课程完成、短语回顾和词汇训练完成页中的继续按钮
- Roadmap 页面的悬浮“继续”按钮、测试建议主操作和章节切换按钮
- Roadmap 能力值弹层中的“开始”按钮

语音练习仍可能需要系统麦克风授权；这类授权不应由用户脚本绕过。

## 调研结果

截至 2026-10-31：

- GitHub 代码搜索 `app.appewa.com in:file`：0 个结果。
- GitHub 仓库、Issue 搜索 Appewa 键盘或用户脚本：没有找到相关项目。
- ScriptCat 搜索 `appewa`：0 个结果。
- OpenUserJS 遇到限流；Greasy Fork 在当前网络环境无法稳定访问，因此不能声称已经穷尽 Greasy Fork 的站内结果。

结论是**没有找到公开可用的现成脚本**，所以这里按当前 Appewa 前端结构单独实现。

## 实现依据

已核对线上页面与公开前端 bundle（EWA `26.1030.9867`）：

- 网站自带 `LessonKeyboard`，只处理字母和 `Backspace`，没有 `Enter`、方向键或确认按钮的全局快捷键。
- 主操作按钮稳定使用 `lesson.primary_action_button`。
- 验证弹层操作使用 `*.validation.action_button`。
- 选项区域及选项项使用 `*.answers_viewport`、`*.answer.*`、`*.keyboard.*`、`*.task.*`。
- 实际课程页只读检查确认存在 `lesson.close_button`、`lesson.primary_action_button`、`exercise.renderer.<uuid>.answers_viewport` 和 `exercise.renderer.<uuid>.questions.hint_button`。

脚本不依赖容易变化的 CSS 类名，也不拦截字母输入。

## 验证边界

已完成脚本语法检查和本地模拟页面交互测试，覆盖：

- `Enter` 首次会聚焦并触发检查/继续；如果站点没有接受脚本触发的点击，焦点已经停留在主按钮，再按一次 `Enter` 会由浏览器原生激活。验证弹层按钮优先于主按钮。
- 键盘监听在捕获阶段运行，Appewa 的 React Native Web 按钮拦截 `keydown` 时不会吞掉脚本快捷键。
- 退出确认弹层存在时，`Enter` 不会绕过确认直接提交。
- 方向键跳过禁用和隐藏选项，`Space` 与 `1`–`9` 可激活选项；词块外层可聚焦、内层才是实际按钮时，会优先点击内层按钮。
- 词语块支持连续字母匹配，例如快速输入 `am` 会点击可见的 `am` 词块；单词块仍可只按首字母选择，例如输入 `i` 会点击可见的 `I` 词块。
- 输入框中的字母、`Backspace` 和 `Enter` 保持网站原生行为。
- `F1` 打开帮助并显示当前脚本版本，`Esc` 关闭当前脚本面板并恢复焦点。
- `Alt+R`、`Alt+S`、`Alt+H` 分别触发播放、慢速和提示控件。
- `Alt+M` 打开错题本；错误反馈只记录一次，第二次尝试答错才新增记录。
- 错题本默认不发起任何网络请求；模拟 AI 接口验证了仅在点击生成后发送精简错题并显示返回总结。
- API 设置和错题记录可跨页面重载保留；清空操作会同时清除上次 AI 总结。
- 课程完成页可识别 `lesson.completion_result.continue_button` 等继续按钮；按 `Enter` 进入“下一页”，按 `1`–`5` 选择课程评分。
- Roadmap 页可识别 `roadmap.continue_button`；按 `Enter` 继续当前课程，聚焦其他原生按钮时仍由浏览器处理 Enter。
- Roadmap 能力值弹层可识别 `energy.activity_popup.primary_button`；弹层打开后按 `Enter` 直接开始课程，不会被全屏遮罩按钮截获。

也对当前线上课程页和 Roadmap DOM 做了只读匹配检查。`0.2.0` 的验证没有提交当前练习、没有改变课程进度，也没有提交课程评分或调用真实 AI 接口。

尚未在当前浏览器中做完整的逐题人工验收；不同课程若新增了不带上述 `data-testid` 的控件，可能需要补充选择器。
