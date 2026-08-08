# 禹合 ERP Blueprint v1.0 — 規格審查報告

> 審查角色：ERP 系統架構審查員
> 審查對象：《禹合 ERP Blueprint v1.0》（2026-08-08，文件狀態：定稿基線）
> 審查日期：2026-08-08
> 審查性質：**只做規格審查，不進行程式實作、不修改原始 Blueprint、不觸碰任何正式系統**
> 嚴重度標註：Critical（財務錯誤／資料遺失／越權／正式系統中斷）、High、Medium、Low

---

## 1. 審查結論

### 結論：**修正後可定稿（Conditional Go）**

**理由：**

《Blueprint v1.0》在**設計原則層級**已達到可作為開發依據的成熟度：Event-driven 請款、「已開請款 ≠ 已收款」「預計完成 ≠ 實際完成」的紅線（§5.3）、財務可重算（§7.3、§10.3、§10.4）、Migration 雙軌與 Shadow Automation（§20）、AI 人在迴路與 Prompt Injection 防護（§18.2）、Family 資料隔離（§0.5、§8、§18）、權限矩陣（§19）都寫得清楚且自洽，屬同級 SMB ERP 規格中的上段水準。

但文件**不能以現狀直接進入「新 DB 建置」**，原因是有數個會直接影響**財務正確性與資料可稽核性**的規格缺口，且都落在文件自己標為「已確認」的規則上：

1. **「合併請款」是已確認規則（§26.9、EVT-013），但 Schema §7.2 沒有「請款單（InvoiceRequest／Invoice）」實體**，導致一張請款單合併多筆應收的結構無處落地 —— 這是 Critical。
2. **PaymentAllocation（§7.2）為多型外鍵且無「分攤總額不得超過應收／應付原值」的約束**，在無交易保證的 Google Sheet 上會產生超收、重複分攤、對帳不平的實質風險 —— Critical。
3. Executive Summary（§1）宣稱「一次涵蓋 20 個模組與**完整資料模型**」，但 §7.2 對多個模組（AI、HR、Warranty 責任判定、Marketing 子實體、Knowledge/SOP 子實體、範本實體、Checklist、DailyLog）**缺實體**，ER 圖（§8）又只是 Schema 的子集 —— 這使「完整資料模型」的宣稱與內容矛盾，屬 Major。

上述屬於**規格補強**而非架構翻案，故判定為「修正後可定稿」。**只讀盤點（Inventory）階段可立即開始（零風險）**；「新 DB」階段需通過下方 §11 的 Gate 後才進入。

---

## 2. Critical Issues

> 會造成財務錯誤、資料遺失、重複請款、越權或正式系統中斷者。

| # | 嚴重度 | 章節／實體 | 問題 | 後果 |
|---|---|---|---|---|
| C-1 | **Critical** | §7.2 Schema／§07 Finance／§26.9、EVT-013 | **缺「請款單（InvoiceRequest / Invoice）」實體**。§07 模組主要資料列出 `InvoiceRequest`，§26.9 與 §10.1、§10.6.（追加）皆要求「追加工程可與尾款等合併在同一請款單，但明細關聯不可消失」，但 §7.2 核心實體表**沒有任何請款單／請款單明細（InvoiceLine）實體**，Receivable 之間也沒有「歸戶到同一請款單」的分組鍵。 | 合併請款無法在資料層表達；一旦以人工或彙總欄位代替，將違反 §0.4「彙總不得成為唯一真值」，並帶來重複請款、金額對不上、無法逐筆回溯來源事件的風險。 |
| C-2 | **Critical** | §7.2 PaymentAllocation／§7.3 衍生值／§14 Google Sheet | **分攤缺完整性約束**。PaymentAllocation 以 `receivable_id/payable_id`（多型單欄）表示對象，且未定義：(a) 一筆 Payment 的分攤總額 = Payment.amount；(b) 對單筆 Receivable 的分攤總和 ≤ Receivable.amount（禁超收）；(c) allocation 方向必須與 Payment.direction 一致（收款不得分攤到應付）。在 Google Sheet（無 FK、無交易、無唯一約束）上，這些只能靠應用層 Lock 保證，而 §14.2 僅提到 LockService 級別的粗鎖。 | 超額分攤、重複分攤、收付方向錯置、`未收 = 應收 − 已分攤實收`（§7.3）算出負數或錯值；財務報表與現金流失真。 |
| C-3 | **Critical** | §1 Executive Summary vs §7.2 vs §8 ER | **「完整資料模型」名不符實 → 開發期被迫自行補實體**。宣稱涵蓋 20 模組完整資料模型，但 §7.2 對下列模組缺實體：AI（§14 `AIConversation/AIRequest/Citation/SuggestedAction/ApprovalRecord`）、AI 行政助理（§19 `MeetingBrief/ActionDraft/...`）、HR（§11 `Employment/Skill/Attendance/Leave/Training/Compensation`）、Warranty 責任鏈（§13 `ServiceVisit/Responsibility/Resolution`）、Marketing（§10 `Asset/PublishSchedule/LeadAttribution/AwardSubmission/ShootPlan`）、Knowledge/SOP 子實體、各類**範本實體**（`MilestoneTemplate/PhaseTemplate/DocumentTemplate`，雖被 `template_id`/`template_phase_id` 引用卻無定義）、`Checklist`、`DailyLog`。 | 因 §28 驗收清單要求「Schema、狀態值、主外鍵與衍生值口徑確認」才可實作，缺實體會讓開發者被迫**自行虛構結構**（違反 §0.1「待確認不得自行補值」），造成後續 schema 反覆重做，正是 DEC-001 想避免的風險。 |
| C-4 | **Critical** | §20.2 Step 6 Shadow Automation／§17.1 Telegram／§17.3 Calendar | **Shadow 期間未指定「隔離的通知/行事曆目標」**。§20.1 要求「Telegram 每日 7 點、Calendar 不得修改」，Shadow 模式（§20.2-6）只說「不對外發送、不改正式資料」，但**未規定新版自動化必須使用與正式不同的 Telegram Bot／群組與測試用 Calendar**。§17.4 只針對 Hermes 的「同一支 Bot 不得兩端連線」下了防呆，未延伸到「ERP 新自動化 vs 正式 7 點通知共用 Token/群組」的情境。 | 雙軌期間若誤用同一 Bot Token 或同一正式 Calendar，會造成**重複發 Telegram、污染正式行事曆、客戶收到重複請款/提醒**，直接違反「正式系統零中斷」（§20.1）。 |

---

## 3. Major Issues

> 會讓後續開發產生歧義、重做或模組無法銜接者。

| # | 嚴重度 | 章節／實體 | 問題 | 影響 |
|---|---|---|---|---|
| M-1 | **High** | §8 ER Diagram vs §7.2 Schema | ER 圖為 Schema 的**子集且不一致**：Schema 有 FK 但 ER 無對應邊者包含 `Opportunity.project_id`、`Task.assignee_id→Person`、`Payable.vendor_id→Vendor`、`MaterialSelection`、`RiskIssue`、`CostCode`、`FixedExpense`、`Campaign`、`CalendarEvent.task_id`、`Installation.task_id`、`Person/RolePermission` 等；`Milestone.template_id`、`ConstructionPhase.template_phase_id` 指向未定義的範本實體。 | §28 要求「ER 與 Schema、流程、20 模組一致」才可定稿；目前三者不一致，開發者難以確定關聯基數與外鍵方向。 |
| M-2 | **High** | §5.1 主流程（已確認）／§5.2 Project 階段／EVT-023 | **設計案未承接工程時，缺乏「設計結案」路徑與終態**。§5.1「否」分支只到「交付約定之設計成果」，但 §5.2 Project 階段列舉自 `CONSTRUCTION_QUOTING → CONSTRUCTION_CONTRACTED → ... → CLOSED`，**沒有 design-only 的結案階段值**；EVT-023 結案又以「工程、財務、文件、保固條件」為前置，而 design-only 案件無工程、無保固（§13 保固自完工日起）。 | 大量「只做設計、未接工程」案件（此為公司真實常態）無法正常結案，會卡在中間階段或被迫套用不適用的工程/保固條件。 |
| M-3 | **High** | §6 Event Trigger 表／§7.2 Milestone、TriggerEvent／§5.2 | **23 個 EVT 與 Milestone.type／Project.current_phase 的對應未定義**。TriggerEvent（§7.2）有 `event_type` 與 `source_entity_id`，但沒有欄位或對照表說明某個 EVT 觸發後應把哪個 Milestone 設為 COMPLETED、或把 Project 推進到哪個 phase；ER 圖也未連 TriggerEvent↔Milestone。 | 狀態機無法實作；「事件 → 里程碑 → 階段」推進邏輯會由開發者各自解讀，導致模組銜接歧義。 |
| M-4 | **High** | §14 AI Assistant `ApprovalRecord`／§18.2／§10.5／§G AI 安全 | **「人在迴路」核准缺專屬實體**。§1 與 §18.2 反覆要求敏感操作需人工核准、AI 建議與人工核准要留紀錄，但 §7.2 無 `ApprovalRecord/SuggestedAction`，AuditLog 也未定義「AI 建議 → 待核 → 核准/駁回」的欄位。 | 無法稽核「哪個 AI 建議被誰在何時核准」，使 §G 的核心保證（AI 不得自動簽約/付款/認驗收）無資料佐證，違反 §1「可追溯」原則。 |
| M-5 | **High** | 全文 Integration／§12 Knowledge／§17 SOP vs Obsidian | **Obsidian 定位在 Blueprint 中完全未定義 → 知識/SOP 恐有兩套真值**。審查目標 E 要求「Obsidian 定位為 Blueprint、SOP、知識與工作入口」，但整份文件**未出現 Obsidian**；而 §12 KnowledgeArticle、§17 SOPTemplate 又把知識/SOP 存在 ERP DB 內。 | ERP KnowledgeArticle/SOPTemplate 與 Obsidian 之間無主從/同步定義，將形成**永久性雙真值來源與重複人工維護**（違反 §0.1 單一事實來源精神）。 |
| M-6 | **Medium** | §7.2 缺 `DailyLog`／`Checklist`／`SubcontractorAssignment`（§05）、`ServiceVisit/Responsibility/Resolution`（§13） | 工程模組主要資料列 `DailyLog（施工日誌）、Checklist、SubcontractorAssignment`，§9.2 亦提及施工日誌，但 Schema 只有 `SiteVisit/Inspection`（≠ 日誌／檢查表範本）。保固模組主要資料列 `ServiceVisit/Responsibility/Resolution`，Schema 只有 `WarrantyPolicy/WarrantyCase`。 | 工地每日紀錄、QC 檢查表、工班指派、保固責任判定/服務到場都無處存放；模組畫面（今日工地、照片時間線、責任工班）無資料支撐。 |
| M-7 | **Medium** | §7.2 `RFQ/VendorQuote`（單列兩主鍵）、`PaymentAllocation`（多型欄）、§07 `Allocation` vs `PaymentAllocation` | **實體邊界與命名不清**：`RFQ/VendorQuote` 兩個不同實體被合併成一列且列兩個主鍵；§07 稱 `Allocation`，§7.2 稱 `PaymentAllocation`。 | 開發者需自行拆分/對齊，易生誤解與重做。 |
| M-8 | **Medium** | §7.2 缺「沖銷／折讓（Credit Note / Reversal）」實體；§10.5 僅文字描述 | §10.5 要求「已核對 Payment 不得無痕修改；更正以沖銷／新紀錄處理」，但 Schema 僅有 `VOID` 狀態，無沖銷單/紅字實體來承載「反向金額 + 引用原紀錄」。 | 財務更正只能靠改狀態，無法保留「原始 + 沖銷 + 重開」三段可稽核鏈；對帳與稅務口徑（§24.13）無依據。 |

---

## 4. Minor Improvements

> 命名、文件治理、欄位與可維護性改善。

| # | 嚴重度 | 章節／實體 | 建議 |
|---|---|---|---|
| N-1 | Low | §5.2 Milestone 狀態 vs §7.2 Task 狀態 | 兩套近義但不同的詞彙（Milestone `NOT_STARTED/COMPLETED` vs Task `TODO/DONE`）。建議在 Data Dictionary 明列各實體狀態機，避免開發者混用。 |
| N-2 | Low | §04 Project `Risk`、`Issue` vs §7.2 `RiskIssue` | 模組把 Risk 與 Issue 並列，Schema 合併為單一 `RiskIssue`。建議統一：合併則模組文字同步，或拆分為兩實體。 |
| N-3 | Low | §1 Executive Summary（Telegram 屬第一批）vs §21 Roadmap（Telegram 自動化屬 Stage 4） | 上線批次對 Telegram 的定位不一致，建議統一敘述（「通知讀取」與「事件自動發送」分開列）。 |
| N-4 | Low | §7.1 共通欄位 `version`（單一整數） | 未區分「樂觀鎖版本」與「內容版本歷史」。建議 Data Dictionary 註明 `version` 語意，並說明哪些實體另有版本子表（已有 DrawingVersion/DocumentVersion/Contract.version/Quote.version）。 |
| N-5 | Low | §14 Google Sheet §14.2 工作簿切分 | 建議在 Data Dictionary 對每個 tab 標註「原始交易 / 彙總（可重建）」屬性（呼應 §14.1），避免彙總 tab 被誤當真值。 |
| N-6 | Low | §7.2 `TriggerEvent.evidence`、`Milestone.evidence_link` | evidence 型別（Drive file id / URL / 文字）未統一，建議定義 evidence 為結構化引用（type + ref_id），與 §15 Drive「只存 file/folder ID」原則一致。 |
| N-7 | Low | §22 已確認案件資料基線 | 表格含未標年份日期（7/31、7/20、8 月中），已於 §24.5 列為待確認；建議在 §22 每列直接標「年份待確認」旗標，避免匯入時被誤用（目前僅在表尾與 §24 提及）。 |

---

## 5. Contradictions（逐項引用章節）

| # | 嚴重度 | 矛盾點 | 章節 A | 章節 B |
|---|---|---|---|---|
| X-1 | **High** | 宣稱「完整資料模型」，但實際缺多個模組實體 | §1 Executive Summary「一次涵蓋 20 個模組與完整資料模型」 | §7.2 核心實體表（缺 AI/HR/Marketing/Warranty 子實體/範本/InvoiceRequest 等） |
| X-2 | **High** | 「合併請款」為已確認規則，但無承載實體 | §26.9 已確認規則、EVT-013、§10.1 | §7.2 無 InvoiceRequest／請款單明細 |
| X-3 | Medium | 財務子域實體命名不一致 | §07 模組主要資料稱 `InvoiceRequest`、`Allocation` | §7.2 稱 `PaymentAllocation`，且無 InvoiceRequest |
| X-4 | Medium | 「完工」與「驗收」先後定義不一致 | §5.1 主流程（已確認）：`驗收＋尾款10% → 完工日起一年保固`（驗收≈完工） | §9.4／§9.5：`尾款事件 → 交屋文件 → 完工日核准 → 建立一年保固`（完工在尾款/驗收之後，另需核准） |
| X-5 | Medium | ER 與 Schema 關聯不一致 | §8 ER Diagram（無 Opportunity–Project、Vendor–Payable、Task–Person 等邊） | §7.2 Schema（存在對應 FK） |
| X-6 | Medium | 工程模組資料列有、Schema 無 | §05 Construction 主要資料：`DailyLog、Checklist、SubcontractorAssignment` | §7.2（僅 SiteVisit/Inspection/Defect） |
| X-7 | Low | 「同一套邏輯資料模型」與財務隔離的敘述張力 | §0.5「除 Family 外公司資料使用同一套邏輯資料模型」 | §14.2「DB_FINANCE（權限隔離）」、§07「不見銀行餘額」（屬權限隔離，非資料模型分裂，建議加註釐清） |

> 說明：X-4、X-7 屬「敘述層」矛盾，且 §24.4 已將「完工/驗收/交屋正式定義」列為待確認；仍建議在 §5.1 或 §9.4 加註以消除「已確認流程」內部的不一致。

---

## 6. Missing Requirements

> 依審查限制，**不代填答案**；僅指出缺口並分級。

### 6.1 實作前一定要補（進入「新 DB」前必須到位）

| # | 嚴重度 | 缺口 | 對應章節 |
|---|---|---|---|
| MR-1 | Critical | 請款單（InvoiceRequest/Invoice）+ 明細（InvoiceLine）實體與「Receivable→請款單」歸戶鍵定義 | §07、§10.1、§26.9、EVT-013 |
| MR-2 | Critical | PaymentAllocation 完整性規則（分攤總額=付款額、不超收、方向一致）與 Sheet 上的並發保護策略 | §7.2、§7.3、§14.2 |
| MR-3 | Critical | Shadow/雙軌期間的**隔離通知目標**（獨立 Telegram Bot/群組、測試 Calendar）明文化 | §20.2-6、§17.1、§17.3 |
| MR-4 | High | EVT ↔ Milestone.type ↔ Project.phase 的對照表（狀態機推進規則） | §5.2、§6、§7.2 |
| MR-5 | High | AI 核准鏈實體（SuggestedAction / ApprovalRecord）與 AuditLog 欄位 | §14、§18.2、§10.5 |
| MR-6 | High | Design-only 案件的結案階段值與 EVT-023 於「無工程/無保固」時的條件 | §5.1、§5.2、EVT-023 |
| MR-7 | High | Obsidian 與 ERP Knowledge/SOP 的主從/同步定位（避免雙真值） | §12、§17、審查目標 E |
| MR-8 | High | 缺漏實體補齊：DailyLog、Checklist/ChecklistTemplate、SubcontractorAssignment、ServiceVisit、Responsibility、Resolution、範本實體、沖銷/折讓實體 | §05、§13、§7.2、§10.5 |
| MR-9 | Medium | Data Dictionary（每 tab/欄位 key、型別、參照、原始 vs 彙總標記）——§28 驗收清單前置 | §14.1、§21 Stage 0、§28 |

### 6.2 可在後續階段確認（不阻擋只讀盤點與 schema 骨架）

以下已於 §24 Open Questions（1–22）完整列出，且文件正確地禁止自行補值（§0.1、§27），屬「後續確認」而非「實作前硬缺」：

- 設計三期款金額/比例/稅/期限與請款格式（§24.1）；工程 30/30/30/10 計算基礎是否含稅/追加/折讓與四捨五入（§24.2）。
- 完工/交屋/驗收正式定義與保固精確起訖（§24.4、§22 表尾）。
- 未標年份日期之確切年份（§24.5、§22）。
- 既有案件財務/Drive/工班映射（§24.7）；MASTER 實際 tabs/欄位/公式（§24.8）；戰情室/Script/Trigger/Bot 清單（§24.9）。
- LINE 帳號型態與資料保存/同意（§24.10）；Calendar 單/雙向與衝突主權（§24.11）。
- 幣別/稅務/發票/銀行/期初餘額/會計口徑（§24.13）；固定支出細目（§24.14）。
- 角色工時/假日/超載門檻（§24.15）；健康度與通知權重（§24.16）；素材授權政策（§24.17）。
- AI 供應商/模型/資料保留（§24.18）；Migration 容許差異/窗口/回復目標（§24.19）；Portal 需求（§24.20）；Hermes 常駐與健康檢查（§24.21、§24.22）。

---

## 7. Schema Review（實體／問題／影響／建議修正／嚴重度）

| 實體 | 問題 | 影響 | 建議修正 | 嚴重度 |
|---|---|---|---|---|
| **（缺）InvoiceRequest / InvoiceLine** | §07 提及但 §7.2 未定義 | 合併請款無法落地、明細關聯消失 | 新增 InvoiceRequest(id, project_id, status, issued_at, total) 與 InvoiceLine(invoice_id, receivable_id, amount)，Receivable 增 `invoice_id` 弱關聯 | Critical |
| **PaymentAllocation** | 多型 `receivable_id/payable_id` 單欄；無超額/方向約束 | 超收、重複分攤、`未收` 算錯 | 拆為 `target_type + target_id`（或兩個可空 FK）；加規則：Σalloc(payment)=payment.amount、Σalloc(receivable)≤amount、direction 一致 | Critical |
| **Receivable / Payable** | 缺「歸戶請款單」鍵；缺沖銷關聯 | 無法群組請款、無法紅字更正 | 加 `invoice_id`（Receivable）、`reversal_of_id`／沖銷實體 | High |
| **TriggerEvent** | 未定義與 Milestone/phase 的推進對映 | 狀態機不可實作 | 加對照表或 `affects_milestone_id/target_phase` 語意；ER 補 TriggerEvent–Milestone 邊 | High |
| **Milestone** | `template_id` 指向未定義的 MilestoneTemplate | FK 懸空 | 定義 MilestoneTemplate 實體 | High |
| **ConstructionPhase** | `template_phase_id` 指向未定義範本 | FK 懸空 | 定義 PhaseTemplate 實體 | Medium |
| **Document** | `template_id` 指向 DocumentTemplate（§08 有、§7.2 無） | FK 懸空 | 於 §7.2 補 DocumentTemplate | Medium |
| **RFQ/VendorQuote** | 兩實體合併一列、雙主鍵 | 關聯與基數不清 | 拆為 RFQ 與 VendorQuote 兩實體，VendorQuote.rfq_id FK | Medium |
| **（缺）DailyLog / Checklist / ChecklistTemplate / SubcontractorAssignment** | §05 列出、Schema 無 | 工地日誌/QC/工班指派無處存 | 補上述實體，關聯 project_id/phase_id | Medium |
| **（缺）ServiceVisit / Responsibility / Resolution** | §13 列出、Schema 無 | 保固責任判定無資料 | 補實體，關聯 warranty_case_id | Medium |
| **（缺）ApprovalRecord / SuggestedAction** | §14 列出、Schema 無 | AI 人在迴路不可稽核 | 補實體，關聯 actor_id、entity、decision、decided_at | High |
| **（缺）HR：Employment/Skill/Attendance/Leave/Training/Compensation** | §11 列出、Schema 無 | HR 模組（第三批）無 schema | 至少定義骨架與敏感度標記（第三批前補） | Medium |
| **（缺）Marketing：Asset/PublishSchedule/LeadAttribution/AwardSubmission/ShootPlan** | §10 列出、Schema 無 | 行銷模組無 schema | 補實體或明確標記第三批延後 | Low |
| **（缺）Knowledge/SOP 子實體：Category/Tag/Source/Approval/AccessLevel、SOPVersion/ChecklistTemplate/TrainingAcknowledgement** | §12/§17 列出、Schema 無 | 知識/SOP 版本與存取層級無 schema | 補實體或標記延後 | Low |
| **Opportunity** | `project_id` FK 於 ER 無邊；Lead→Opp→Project 生成順序 | 建立順序/關聯不明 | ER 補 Opportunity–Project 邊，註明成交轉 Project 時機 | Low |
| **共通欄位（§7.1）** | `version` 語意未定；Sheet 無 FK/交易 | 並發與完整性靠應用層 | Data Dictionary 定義 version；Finance tab 明訂 Lock/冪等鍵/唯一鍵策略 | High |

---

## 8. Module Coverage Matrix（20 模組）

> 評分維度：目的、主要使用者、主要資料、主要畫面、主要自動化、權限、**與其他模組輸入/輸出關係**。
> 說明：§4 各模組的前六項普遍齊備；**「跨模組輸入/輸出關係」在全部 20 模組皆未明文**（僅靠共用實體隱含），故凡此項缺失者列「部分完整」。

| # | 模組 | 評級 | 缺少/待補內容 |
|---|---|---|---|
| 01 | CRM 客戶商機 | 部分完整 | 缺跨模組 I/O 明文；Lead↔Opportunity 邊界（與 02）需釐清 |
| 02 | Sales 銷售簽約 | 部分完整 | 缺 I/O 明文；Opportunity–Project 關聯（§8 ER 未畫） |
| 03 | Design 設計管理 | **完整** | 六項齊備且含「限制：未接工程不出後段圖」（唯一有明訂限制者）；I/O 仍建議補 |
| 04 | Project 專案管理 | 部分完整 | Risk/Issue 與 §7.2 RiskIssue 命名不一；EVT→phase 推進未定義 |
| 05 | Construction 工程管理 | **不足** | 主要資料 DailyLog/Checklist/SubcontractorAssignment 無 Schema 實體 |
| 06 | Procurement 採購管理 | 部分完整 | RFQ/VendorQuote 實體拆分不清；缺 I/O 明文 |
| 07 | Finance 財務中心 | **不足** | InvoiceRequest 無實體、Allocation 命名不一、缺沖銷實體（見 C-1/C-2/M-8） |
| 08 | Documents 文件中心 | 部分完整 | DocumentTemplate 於 §7.2 缺；其餘齊備 |
| 09 | Schedule 行程中心 | 部分完整 | Reminder/Availability/TaskSchedule/ExternalCalendarMap 多未成實體；Calendar 主權待定（§24.11） |
| 10 | Marketing 行銷中心 | 部分完整 | Asset/PublishSchedule/LeadAttribution/AwardSubmission/ShootPlan 無 Schema（第三批可延後但需標記） |
| 11 | HR 人員管理 | 部分完整 | Employment/Skill/Attendance/Leave/Training/Compensation 無 Schema |
| 12 | Knowledge 知識庫 | 部分完整 | 子實體無 Schema；**與 Obsidian 真值分工未定義（M-5）** |
| 13 | Warranty 保固中心 | **不足** | ServiceVisit/Responsibility/Resolution 無實體；完工/驗收定義待確認（X-4） |
| 14 | AI Assistant | 部分完整 | AIConversation/ApprovalRecord 等無 Schema（影響人在迴路稽核 M-4） |
| 15 | CEO Dashboard | **完整** | 六項齊備，卡片可回溯來源、顯示更新時間（§11）；資料依賴其他模組，本身唯讀聚合定位清楚 |
| 16 | Analytics 經營分析 | 部分完整 | 指標定義為衍生，需依賴 §7.3 口徑；指標實體/快照未成 Schema |
| 17 | SOP 營運制度 | 部分完整 | SOPVersion/ChecklistTemplate/TrainingAcknowledgement 無 Schema；與 Obsidian 分工未定義 |
| 18 | Family 家庭行程 | **完整** | 隔離設計明確（獨立 DB、僅 busy projection、AI 無內容權限），符合 §0.5 |
| 19 | AI 行政助理 | 部分完整 | MeetingBrief/ActionDraft/... 無 Schema；與 14 AI Assistant 職責邊界略重疊需釐清 |
| 20 | Capacity 產能管理 | 部分完整 | Assignment/Conflict/Scenario 無 Schema；基準工時待建立（§13.3、§24.15） |

**統計：完整 4（03/15/18 + 大致完整者），部分完整 13，不足 3（05/07/13）。**

---

## 9. Migration Safety Review

> 檢查現行 MASTER、戰情室 App、Apps Script、Telegram、Calendar、Hermes 是否受保護。

| 保護對象 | 現況評估 | 依據章節 | 風險與建議 |
|---|---|---|---|
| **現行 MASTER（Sheet）** | ✅ 受保護 | §0.2、§2.3、§14.1、§20.1、DEC-002、§26.14 | 明訂不動、建全新 DB；建議只讀盤點以「複本/唯讀權杖」進行，避免誤寫 |
| **禹合戰情室 App** | ✅ 受保護 | §20.1、§26.14 | 明訂不改；建議盤點時不觸發其寫入路徑 |
| **Apps Script / Trigger** | ✅ 受保護（原則） | §16（僅規格）、§20.1、§26.14 | 新自動化須用**獨立 Script 專案與服務帳號**，勿掛載於現行 Trigger（建議明文，目前未寫死） |
| **Telegram 每日 7 點** | ⚠️ 原則受保護，缺技術隔離 | §17.1、§20.1、§26.14 | **C-4：Shadow 未指定獨立 Bot/群組**，有重複發送風險；需明訂雙軌用不同 Bot Token |
| **Google Calendar** | ⚠️ 原則受保護，缺技術隔離 | §17.3、§20.1 | Shadow 未指定測試用 Calendar；雙向同步主權待定（§24.11）。建議雙軌寫入獨立 Calendar |
| **Hermes（AI/Telegram Gateway）** | ✅ 受保護且定位正確 | §17.4、DEC-009、§26.17 | 正確定位為 Gateway 非 ERP DB；「同一 Bot 不得兩端連線」「先停筆電再啟桌機」防呆完整；憑證分離移轉規範佳（§17.4、§26.18） |
| **Google Drive / Obsidian 既有資料** | ✅（Drive）／⚠️（Obsidian 未定義） | §15、§2.3 | Drive「只存 file/folder ID、不動既有資料」良好；Obsidian 角色未定義（M-5） |
| **Migration 機制本身** | ✅ 結構完整 | §20.2（9 階段）、§20.3 Gate、§23 Risks | 具 Inventory→Mapping→Dual Run→Shadow→Acceptance→Cutover→Rollback→Stabilization、AuditLog、對帳、權限測試；門檻值待確認（§24.19） |

**小結：** 「現行正式系統零中斷」原則在**治理層完整**，但在**技術隔離層有兩個實作前必補項**（C-4：Telegram/Calendar Shadow 目標隔離；建議 Apps Script 獨立專案/服務帳號明文化）。除此之外，Migration 策略足夠安全。

---

## 10. Proposed Patch List（建議修改的 Blueprint 章節）

> 僅列「應改章節 + 理由 + 建議文字方向」，**不直接改檔、不寫程式**。

| Patch | 目標章節 | 修改理由 | 建議新增/修改方向（文字，非程式） |
|---|---|---|---|
| P-1 | §7.2 Schema | 補 C-1 請款單缺口 | 新增 `InvoiceRequest`、`InvoiceLine` 實體列，並於 `Receivable` 增 `invoice_id`；於 §10.1 補「一張請款單可合併多筆 Receivable，明細以 InvoiceLine 保留」 |
| P-2 | §7.2 + §7.3 | 補 C-2 分攤完整性 | `PaymentAllocation` 改 `target_type+target_id`；於 §7.3 加不變式：Σ分攤=付款額、對單筆應收分攤≤原值、方向一致 |
| P-3 | §20.2 / §17.1 / §17.3 | 補 C-4 通知隔離 | 明訂「Shadow/雙軌期間，新自動化一律使用獨立 Telegram Bot/群組與測試 Calendar，禁用正式 Bot Token 與正式 Calendar」 |
| P-4 | §1 或 §7 前言 | 修 C-3/X-1 宣稱 | 將「完整資料模型」改為「第一批模組完整、其餘模組列示核心實體、細部 schema 分批補齊」，並附「Schema 完成度矩陣」 |
| P-5 | §5.2 + §6（EVT-023） | 修 M-2 design-only 結案 | Project 階段加 `DESIGN_ONLY_CLOSED`（或等義值）；EVT-023 條件加「若無工程合約，工程/保固條件不適用」 |
| P-6 | §6 + §7.2 | 補 M-3 狀態機對映 | 新增「EVT → Milestone.type → Project.phase」對照表；TriggerEvent 加推進語意欄位；§8 ER 補 TriggerEvent–Milestone 邊 |
| P-7 | §7.2 + §18.2 | 補 M-4 AI 核准鏈 | 新增 `SuggestedAction`、`ApprovalRecord`；於 §18.2 標明「所有敏感操作核准必寫 ApprovalRecord」 |
| P-8 | 新增一節（如 §17.5）或 §3.2 | 補 M-5 Obsidian 定位 | 明訂 Obsidian = Blueprint/SOP/知識/工作入口，與 ERP KnowledgeArticle/SOPTemplate 的主從或單向同步關係，避免雙真值 |
| P-9 | §7.2 | 補 M-6 缺漏實體 | 補 `DailyLog、Checklist/ChecklistTemplate、SubcontractorAssignment、ServiceVisit、Responsibility、Resolution、MilestoneTemplate、PhaseTemplate、DocumentTemplate、CreditNote/Reversal` |
| P-10 | §8 ER Diagram | 修 M-1/X-5 | 補齊 Schema 中所有 FK 對應邊，或標註「ER 為簡化圖，完整關聯以 §7.2 為準」 |
| P-11 | §07 vs §7.2 | 修 X-3/M-7 命名 | 統一 `Allocation`→`PaymentAllocation`；拆分 `RFQ/VendorQuote` |
| P-12 | §5.1 或 §9.4 | 修 X-4 完工/驗收 | 於 §5.1 加註「完工日核准為 §9.4 尾款/驗收後之獨立步驟」，與 §9.4/§9.5 對齊 |
| P-13 | §14 / §21 Stage 0 / §28 | 補 MR-9 Data Dictionary | 明列 Data Dictionary 為 Stage 0 交付物，含每欄位 key/型別/參照/原始 vs 彙總標記 |
| P-14 | §1 vs §21 | 修 N-3 Telegram 批次 | 統一 Telegram 在批次/Stage 的敘述 |

---

## 11. Final Go／No-Go

### 對「只讀盤點 → 新 DB → 雙軌驗證」路徑的判定

| 階段 | 判定 | 條件 |
|---|---|---|
| **① 只讀盤點（Inventory，§20.2-1）** | 🟢 **GO（可立即開始）** | 純唯讀、零風險；符合 §27「可建立唯讀盤點工具」。唯一要求：以唯讀權杖/複本進行，不觸發任何現行寫入路徑 |
| **② 新 DB 建置（§20.2-3 New DB）** | 🟡 **Conditional GO** | 須先通過下方 Gate G-1~G-5（清 Critical 與必補 Schema） |
| **③ 雙軌驗證（§20.2-5/6 Dual Run/Shadow）** | 🔴 **HOLD** | 須先通過 Gate G-6~G-9（通知隔離、對帳、權限、冪等） |

### 進入下一階段前的 Gate

**進入「新 DB」前（Gate 集合 A）：**
- **G-1**：C-1 請款單（InvoiceRequest/InvoiceLine）實體與 Receivable 歸戶鍵已定案（P-1）。
- **G-2**：C-2 PaymentAllocation 完整性不變式與 Sheet 並發策略已定案（P-2、§7.1/§14.2）。
- **G-3**：M-6/M-1 必要缺漏實體補齊、ER 與 Schema 對齊（P-9、P-10）。
- **G-4**：M-3 EVT↔Milestone↔phase 狀態機對照表完成（P-6）；M-2 design-only 結案路徑補上（P-5）。
- **G-5**：Data Dictionary（每 tab/欄位、原始 vs 彙總標記）作為 Stage 0 交付物完成（P-13、§28）。

**進入「雙軌驗證」前（Gate 集合 B）：**
- **G-6**：C-4 Shadow 通知隔離明文化——獨立 Telegram Bot/群組、測試 Calendar、獨立 Apps Script 專案/服務帳號（P-3、§20.1）。
- **G-7**：對帳報表與**容許差異門檻**已核准（§20.3、§24.19）。
- **G-8**：權限測試涵蓋育瑄/阿祥/未來角色，且 Family 隔離、Finance 遮罩通過（§19、§20.3）。
- **G-9**：Event 重播冪等驗證——TriggerEvent 狀態 + idempotency_key 不會重複建請款/通知（§16.2、§23、EVT-013/EVT-014）。

### 最終建議

**Blueprint v1.0 判定為「修正後可定稿」。** 可**立即進入只讀盤點（Inventory）**；在完成 Gate 集合 A（清除 4 個 Critical 與必補 Schema）之前**不建議進入新 DB 建置**；在完成 Gate 集合 B 之前**不得進入雙軌與 Shadow 自動化**。文件的治理原則、事件驅動財務、Migration 安全與 AI 安全界線已足以支撐上述分階段推進——缺口集中在**財務請款/分攤的資料建模**與**Schema/ER 的完整性與一致性**，皆屬可在 Stage 0 內補齊的規格工作，無需架構翻案。

---

> 本報告僅為規格審查意見，未修改原始 Blueprint、未撰寫任何程式、未觸碰 MASTER／戰情室／Apps Script／Telegram／Calendar／Drive／Hermes／Family 等任何正式系統或憑證。所有待確認資料一律未代填（遵循 §0.1、§27）。
