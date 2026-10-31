# Appewa Full Keyboard

这是一个用于 Appewa（`app.appewa.com`）课程页的 Tampermonkey 用户脚本，补上网站当前缺少的键盘确认、继续和选项导航能力。当前版本：`0.1.4`。

- [GitHub 仓库](https://github.com/monkey-sking/appewa-full-keyboard)
- [一键安装到 Tampermonkey](https://raw.githubusercontent.com/monkey-sking/appewa-full-keyboard/main/appewa-full-keyboard.user.js)

## 安装

1. 安装 Tampermonkey（Chrome 中 Tampermonkey BETA 同样可用）。
2. 打开上方“一键安装到 Tampermonkey”链接。
3. 在安装页确认后点击“安装”。
4. 刷新 Appewa 课程页。右下角出现 `F1 键盘` 小按钮即表示脚本已运行。

也可以通过 Tampermonkey 的“实用工具 → 从 URL 安装”使用：

```text
https://raw.githubusercontent.com/monkey-sking/appewa-full-keyboard/main/appewa-full-keyboard.user.js
```

## 快捷键

| 按键 | 作用 |
| --- | --- |
| `Enter` | 检查、继续或提交当前练习 |
| `↑` / `↓` / `←` / `→` | 聚焦上一个或下一个选项、词语块 |
| `Space` | 选择当前聚焦的选项（原生按钮和 `div[role]` 均可） |
| `1`–`9` | 直接触发第 N 个可见选项或词语块 |
| `A`–`Z` | 直接选择与所按字母同名的可见词语块 |
| `Home` / `End` | 聚焦第一项 / 最后一项 |
| `Alt+R` | 重播当前可见音频 |
| `Alt+S` | 慢速播放（页面提供时） |
| `Alt+H` | 打开提示（页面提供时） |
| `F1` | 打开或关闭快捷键帮助 |
| `Esc` | 只关闭脚本帮助，不关闭课程 |

输入框内不会拦截按键。字母输入、`Backspace`、`Tab`、`Space` 和文本输入继续使用网站原生行为。

## 支持的练习

脚本按 Appewa 的 `data-testid` 工作，覆盖以下渲染器的通用控件：

- 单项选择：`singleChoice`、`chooseIsCorrect`、`chooseMissedLetter`
- 句子和词语组合：`composePhrase`、`composeSentence`、`composeWord`
- 配对：`findPairs`
- 文本内选择：`textWithChooseAnswers`
- 对话：`dialog`
- 拼写、填空等使用站点字母键盘的练习
- 讲解、反馈和验证弹层中的检查 / 继续按钮

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

- `Enter` 触发检查/继续，验证弹层按钮优先于主按钮。
- 退出确认弹层存在时，`Enter` 不会绕过确认直接提交。
- 方向键跳过禁用和隐藏选项，`Space` 与 `1`–`9` 可激活选项；按钮嵌在普通 `div` 中时也能正确定位。
- 词语块与所按字母同名时，直接按 `A`–`Z` 即可选择，例如输入 `i` 会点击可见的 `I` 词块。
- 输入框中的字母、`Backspace` 和 `Enter` 保持网站原生行为。
- `F1` 打开帮助、`Esc` 仅关闭帮助并恢复焦点。
- `Alt+R`、`Alt+S`、`Alt+H` 分别触发播放、慢速和提示控件。

也对当前线上课程页 DOM 做了只读匹配检查。开发时没有提交当前练习、没有改变课程进度，也没有安装到 Tampermonkey。

尚未在当前浏览器中做完整的逐题人工验收；不同课程若新增了不带上述 `data-testid` 的控件，可能需要补充选择器。
