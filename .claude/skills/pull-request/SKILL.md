---
name: pull-request
description: 建立與合併 PR 的慣例——PR 描述的固定段落（摘要與目標、變更內容、驗證證據、受影響的工作單）、在 Slack #debugthon-carpool 公告（經審查的 PR 在審查通過後才公告）、合併後在公告訊息加上 ✅ 並刪除本機分支。當要開 PR、更新 PR 描述、合併（approve、merge）PR，或其他 skill 要求開 PR 時使用。
---

# 建立與合併 PR

- [原則](#原則)
- [建立 PR](#建立-pr)
- [PR 描述](#pr-描述)
- [Slack 公告](#slack-公告)
- [合併](#合併)

## 原則

- 開 PR 不是必要的：是否開 PR 由開發者決定；commit 與 push 仍須先取得開發者同意。
  其他 skill 明定的授權（如 `ticket-developer` 交付審查時開 PR）視同開發者同意。
- 審查不是必要的：PR 可以不經審查，由開發者決定直接合併。
- 每個 PR 都要在 Slack 公告，時機見〈[Slack 公告](#slack-公告)〉；合併後只在公告訊息加上 ✅，不在討論串回覆，也不另發訊息。

## 建立 PR

1. 從 `main` 開分支，commit 並 push（經開發者同意，或依〈[原則](#原則)〉視同同意）。
2. 以 `gh pr create --base main` 建立 PR，描述依〈[PR 描述](#pr-描述)〉的段落撰寫。
3. 依〈[Slack 公告](#slack-公告)〉的時機張貼公告，再把公告連結補進 PR 描述最後（`Slack 公告：<連結>`），讓之後的 session 找得到要加 ✅ 的訊息。
4. 之後補 commit 時，若摘要、變更內容或證據因此改變，更新 PR 描述（`gh pr edit`）；不另發 Slack 訊息。

## PR 描述

PR 描述以繁體中文撰寫，依序包含以下段落：

```markdown
## 摘要與目標

這個 PR 解決什麼問題、要達成什麼。

## 變更內容

- 逐項列出改了什麼（檔案、元件、需求或設計條目）。

## 驗證證據

- 證明這個 PR 可行的證據：執行過的指令與結果（單元測試、Karate、lint、建置）、手動驗證的步驟與觀察、截圖。
- 只改文件時，列出做過的一致性檢查（例如引用的編號都存在、需求與設計的對應已同步）。
- 沒有收集到的證據就不寫；有測試失敗或略過的步驟，照實寫出。

## 受影響的工作單

- 以 GitHub 連結列出，並說明影響，例如 [#12 T12](https://github.com/sohoffice/debugthon-carpool/issues/12)：範圍移除替代方案。
- 沒有受影響的工作單時寫「無」。
```

描述最後加上 conversation 指定的 attribution 行。

## Slack 公告

- 時機：經審查的 PR（如 `ticket-developer` 交付的 PR）在審查通過後才公告，由審查者張貼；不經審查的 PR 開好就公告。
- 頻道：`#debugthon-carpool`（`C0CACP87NKB`），直接發到頻道。
- 內容：PR 標題、PR 連結、摘要與目標、主要變更、受影響的工作單（附連結）。
- 記下訊息的 `message_ts`，並把訊息連結補進 PR 描述。

## 合併

1. 只在開發者要求時合併（`gh pr merge <編號> --merge`；非互動環境必須指定合併方式）；開發者自行合併時，跳到下一步。
2. 確認 PR 已合併（`gh pr view <編號> --json state`）。
3. 在該 PR 的 Slack 公告訊息加上 `white_check_mark` 反應；不在討論串回覆。
4. 刪除該 PR 的本機分支（PR 合併後一定要做，不論是誰合併的）：
   1. 以 `gh pr view <編號> --json headRefName -q .headRefName` 取得分支名稱。
   2. 先 `git status` 確認工作目錄乾淨；有未 commit 的變更時（可能是其他 session 共用這個 checkout），停下來問開發者。
      乾淨才 `git switch main` 後 `git pull --ff-only`，讓本機 `main` 包含合併結果。
   3. `git branch -d <分支>`；若因 squash 或 rebase 合併而被拒，確認 PR 狀態為 `MERGED` 後改用 `git branch -D <分支>`。
   4. 以 `git branch` 確認分支已不存在。
