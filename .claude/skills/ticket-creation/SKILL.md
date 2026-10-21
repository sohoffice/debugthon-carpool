---
name: ticket-creation
description: 建立工作單（GitHub issue，如 T20、T18A）的慣例——編號與標題、描述的固定格式（標頭列、範圍、驗收條件、追溯）、以 GitHub 原生「blocked by」連結建立依賴、拆分成子工作單，以及加入專案看板並設定尺寸與狀態。內容須先經開發者同意才建立。當使用者要求新增、拆分工作單，或需求與設計變更後要補工作單時使用；修改既有工作單的範圍、依賴或追溯時也適用。
---

# 建立工作單

- [權限](#權限)
- [編號與標題](#編號與標題)
- [描述格式](#描述格式)
  - [標頭列](#標頭列)
  - [來源說明](#來源說明)
  - [範圍](#範圍)
  - [驗收條件](#驗收條件)
  - [追溯](#追溯)
- [類別與標籤](#類別與標籤)
- [拆分工作單](#拆分工作單)
- [建立步驟](#建立步驟)
- [驗證](#驗證)
- [回報格式](#回報格式)

工作單是 `sohoffice/debugthon-carpool` 的 GitHub issue，以繁體中文撰寫，並放在使用者專案看板
「內科順路共乘 PoC」（<https://github.com/users/sohoffice/projects/5>）上。

## 權限

- 新增工作單、修改既有工作單的內容（範圍、驗收條件、依賴、尺寸、追溯），**必須**先把完整的標題與描述交給開發者，
  取得同意後才能執行 `gh issue create`、`gh issue edit`。
- 類別與標籤要和標題、描述一起交給開發者同意。
- 建立時一併完成看板、標籤與依賴（見〈[建立步驟](#建立步驟)〉）；這些屬於建立工作單的一部分，不必另外再問。
- 不勾選驗收條件、不關閉或重新開啟工作單、不指派負責人；這些由審查者與開發者負責。

## 編號與標題

- 標題格式為 `Txx 名稱`，例如 `T20 地點搜尋與路線預覽`。T 編號與 issue 編號是兩回事，在描述中引用時兩者都寫：`#30（T20）`。
- 新工作單用下一個未使用的 T 編號（目前最大編號加一）；從既有工作單拆出的子工作單，在原編號後加字母，
  例如 `T06A`、`T18A`～`T18D`。
- 編號永久不變：撤回工作單時關閉該 issue，不重新編號其他工作單。

## 描述格式

依序包含下列段落，最後以來源列結尾：

```markdown
**階段 1：供給鏈** · **尺寸：M** · **依賴：** #3（T03）、#5（T05）

> [!NOTE]
> 依據 [PR #29](https://github.com/sohoffice/debugthon-carpool/pull/29) 新增的 DD-28 與修改後的 DD-21（已合併）。

## 範圍

- …

## 驗收條件

- [ ] …

## 追溯

`REQ-001` `REQ-003` `DD-21` `DD-28`

---
來源：`docs/requirement.md`、`docs/design.md`
```

### 標頭列

一行，三個欄位以 ` · ` 分隔：

| 欄位 | 內容 |
|---|---|
| 階段 | `階段 0：基礎建設`、`階段 1：供給鏈`、`階段 2：媒合`、`階段 3：使用者介面`、`階段 4：Demo 與交付` 之一 |
| 尺寸 | `S`、`M`、`L`；要和看板的 Size 欄位相同。只當作其他工作單容器的父工作單不填 |
| 依賴 | `#issue（Txx）`，以 `、` 分隔；沒有依賴寫 `無`。需要說明原因時，在該項後加 `：說明` |

依賴只列真正要先完成的工作單。標頭列的每一個依賴，都要有對應的原生「blocked by」連結（見〈[建立步驟](#建立步驟)〉）。

### 來源說明

選填，放在標頭列之後：

- 因需求或設計文件 PR 而新增的工作單：用 `> [!NOTE]` 寫明依據哪個 PR，以及新增或修改了哪些條目。
- 從既有工作單拆出：`> 由 Txx 拆出：…`，說明分工與拆出的理由。

### 範圍

- 條列這張工作單要交付的東西，必要時在條目後以括號註明對應的條目，例如 `（DD-31）`、`（REQ-050、DD-23）`。
- 範圍寫「做什麼」，到能判斷做完與否的程度；實作細節（欄位名稱等）可以交給實作決定，但要寫明要記錄在哪裡，例如 `DEV.md` 的 API 表。
- 會新增或修改 API 時，把 `DEV.md` 的 API 表列入範圍。

### 驗收條件

- 用核取方塊 `- [ ]` 條列，每一條都能以測試或展示驗證，寫的是可觀察的結果，不是做法。
- 涵蓋範圍中的每一項，包括邊界與被拒絕的情況（例如「經過上車點之前進入目的地範圍，行程不結束」）。
- 會新增或修改 API 時，**必須**有一條 Karate 情境，至少涵蓋成功、被拒絕（或查不到）與未帶 token。

### 追溯

- 列出這張工作單實作的需求與設計決定，每個編號用反引號包起來，以空格分隔，`REQ-xxx` 在前、`DD-xx` 在後，各自依編號排序。
  連續的範圍可寫成 `` `REQ-063～REQ-065` ``。
- 至少一條 `REQ-xxx` 或 `DD-xx`；每個編號都要存在於 `docs/requirement.md` 或 `docs/design.md`，不引用已撤回的條目。
- 範圍與追溯要互相對得上：範圍做了卻沒追溯，或追溯了卻不在範圍內，都要修正。

## 類別與標籤

每張工作單在看板的 `Category` 欄位設定一個類別，並在 issue 上加標籤。兩者都不寫進描述。

| 類別 | 用於 |
|---|---|
| `Feature` | 交付使用者看得到的功能，追溯至少一條 `REQ-xxx` |
| `Enabler` | 讓功能得以實作的基礎建設或內部元件（例如資料庫結構、外部來源的轉接器），本身使用者看不到 |
| `Tech Debt` | 改善既有程式碼或測試，不改變行為，例如重新命名、重構 |
| `Bug` | 修正與需求或設計不符的行為 |

標籤依範圍會修改的位置加上，可以多個：

| 標籤 | 範圍會修改 |
|---|---|
| `backend` | `backend/`（Go 程式碼、遷移、Karate） |
| `ui/passenger` | `ui/passenger/`；`ui/shared/` 的修改影響乘客介面時也加 |
| `ui/driver` | `ui/driver/`；`ui/shared/` 的修改影響駕駛介面時也加 |
| `docs` | 只修改文件（`docs/`、`DEV.md`、`README`）；程式碼工作單順帶更新文件時不加 |

父工作單的類別與子工作單相同時才設定；標籤取子工作單標籤的聯集。

## 拆分工作單

工作單太大，或其中一部分可以先開始時拆分：

1. 子工作單依〈[描述格式](#描述格式)〉撰寫，編號為原編號加字母，來源說明寫 `> 由 Txx 拆出：…`。
2. 父工作單改成容器：
   - 標頭列的依賴寫 `子工作單 #34（T18A）、#35（T18B）…`，不填尺寸。
   - 加一段 `> 本項拆成 N 張子工作單，本身不含實作；所有子工作單關閉後關閉。`
   - 〈範圍〉改成〈子工作單〉，列出每張子工作單。
   - 〈驗收條件〉只留 `- [ ] 所有子工作單皆已關閉`。
   - 〈追溯〉保留所有子工作單追溯的聯集。
   - 父工作單原本的依賴移到真正需要它的子工作單（標頭列與 blocked by 連結），並移除父工作單上的 blocked by 連結。
3. 以原生 sub-issue 連結把子工作單掛到父工作單下。原本依賴父工作單的其他工作單，改成依賴真正需要的子工作單，或保留依賴父工作單。

## 建立步驟

標題與描述經開發者同意後，依序執行（`gh` 都以 `--repo sohoffice/debugthon-carpool` 指定 repo）：

1. **建立 issue**：`gh issue create --title "Txx 名稱" --body-file <檔案> --label <標籤>`（多個標籤重複 `--label`），把描述先寫到暫存檔，避免 shell 跳脫問題。
2. **建立依賴**：對標頭列的每一個依賴，建立原生「blocked by」連結：

   ```bash
   issue_id() { gh api graphql -f query='query($n:Int!){repository(owner:"sohoffice",name:"debugthon-carpool"){issue(number:$n){id}}}' -F n=$1 -q .data.repository.issue.id; }
   gh api graphql -f query='mutation($i:ID!,$b:ID!){addBlockedBy(input:{issueId:$i,blockingIssueId:$b}){issue{number}}}' \
     -f i=$(issue_id <本工作單>) -f b=$(issue_id <依賴的工作單>)
   ```

   拆分時，另以 `addSubIssue(input:{issueId:<父>, subIssueId:<子>})` 建立 sub-issue 連結。
3. **加入看板**：加入專案 5，Status 設為 `Todo`，Size 設為標頭列的尺寸（父工作單不設 Size），Category 設為同意的類別：

   ```bash
   item=$(gh project item-add 5 --owner sohoffice --url <issue 網址> --format json -q .id)
   gh project field-list 5 --owner sohoffice --format json   # Status、Size、Category 欄位與選項的 ID
   gh project item-edit --id $item --project-id <專案 ID> --field-id <欄位 ID> --single-select-option-id <選項 ID>
   ```

4. **更新相關工作單**：新工作單成為其他工作單的依賴時（例如 T20 是 T15、T16 的依賴），一併修改那些工作單的標頭列並建立「blocked by」連結；
   這屬於修改既有工作單的內容，要和新工作單一起提給開發者同意。

## 驗證

建立或修改後，只檢查這次建立或修改的工作單；不回頭修正其他舊工作單，發現舊工作單的不一致也不提出修改。逐項確認：

- issue 的標籤正確：`gh issue view <編號> --json labels`。
- 看板上有這張工作單，Status、Size 與 Category 正確：`gh project item-list 5 --owner sohoffice --limit 200 --format json`。
- 標頭列的依賴（父工作單則為子工作單）和原生連結一致；下列指令列出所有不一致的工作單，只看這次經手的編號：

  ```bash
  gh api graphql -f query='{repository(owner:"sohoffice",name:"debugthon-carpool"){issues(first:100,states:[OPEN,CLOSED]){nodes{number body blockedBy(first:20){nodes{number}} subIssues(first:20){nodes{number}}}}}}' \
    | jq -r '.data.repository.issues.nodes[] | (.body|split("\n")[0]) as $h
        | ([$h|scan("#([0-9]+)")[]|tonumber]|sort) as $want
        | ([.blockedBy.nodes[].number]+[.subIssues.nodes[].number]|sort) as $have
        | select($want!=$have) | "#\(.number) body=\($want) links=\($have)"'
  ```

  沒有輸出代表一致。
- 〈追溯〉的每個編號都存在於 `docs/requirement.md` 或 `docs/design.md`。

## 回報格式

- 建立或修改的工作單：編號、標題、尺寸、類別、標籤、依賴，附連結。
- 看板與依賴連結的驗證結果。
- 一併修改的其他工作單，以及仍待開發者同意的事項。
