# Finance Module — Business Requirements Discovery Document

**Company ERP System (KWOPS / JTCops)**
**Document Version:** 1.0
**Date:** 20 July 2026
**Prepared by:** ERP Development Team
**Audience:** Finance Department
**Status:** For Review and Completion by Finance

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current ERP Workflow Overview](#2-current-erp-workflow-overview)
3. [Workflow Catalogue (12 Workflows)](#3-workflow-catalogue)
4. [Finance Workflow Integration Points](#4-finance-workflow-integration-points)
5. [Invoice Lifecycle](#5-invoice-lifecycle)
6. [Budget Workflow](#6-budget-workflow)
7. [Procurement Workflow & Finance Integration](#7-procurement-workflow--finance-integration)
8. [Payment Lifecycle](#8-payment-lifecycle)
9. [Accounting Workflow](#9-accounting-workflow)
10. [Reports Required](#10-reports-required)
11. [Roles & Responsibilities (RACI Matrix)](#11-roles--responsibilities-raci-matrix)
12. [Approval Matrix](#12-approval-matrix)
13. [Document Lifecycle](#13-document-lifecycle)
14. [Exception Handling Matrix](#14-exception-handling-matrix)
15. [Risks and Assumptions](#15-risks-and-assumptions)
16. [Open Questions](#16-open-questions)
17. [Finance Department Questionnaire](#17-finance-department-questionnaire)

---

## 1. Executive Summary

### 1.1 Purpose

Our ERP system manages the full operational cycle of the business — from a customer enquiry, through quotation, equipment dispatch, procurement, and project completion. The **Finance module currently has only its user interface built**. No financial business logic (approvals, invoice rules, budgets, payments, accounting entries) has been implemented.

Before development begins, we need the Finance department to:

1. **Understand** how the ERP currently works and where Finance appears in each workflow.
2. **Validate or correct** every assumption the system currently makes about financial processes.
3. **Provide the real-world business rules** — invoice types, approval chains, budget controls, tax treatment, payment handling — so the module can be built to match how the company actually operates.

### 1.2 What Exists Today

| Area | Status |
|---|---|
| Sales workflow (Requirements → Quotations) | Fully working |
| Quotation approval (Finance Officer / Operations Manager approve) | Working |
| Dispatch / project execution | Working |
| Procurement (requests, approvals, POs, goods receipt) | Working |
| Finance UI (Customer Invoices, Lease Invoices, Expenses, Assets, Z Report) | **UI only — screens exist, business rules do not** |
| Budgets, Proforma Invoices, Credit/Debit Notes, GL, Tax engine, Payments | **Not built** |

### 1.3 What This Document Delivers

- A plain-language walkthrough of every ERP workflow (12 workflows).
- The exact points where Finance is — or should be — involved.
- All documents, approvals, statuses, and notifications in each workflow.
- A structured questionnaire for Finance to complete.

Once the questionnaire is answered and open questions resolved, this document becomes the **blueprint for implementing the entire Finance module**.

### 1.4 Currency and Tax Context

- The system currently operates in a **single currency: KWD** (Kuwaiti Dinar, 3 decimal places).
- Quotations store a VAT percentage and VAT amount, but **no tax engine exists** — tax is entered manually.
- Multi-currency, exchange rates, and formal tax configuration are all open items for Finance to define.

---

## 2. Current ERP Workflow Overview

### 2.1 The Departments and Roles in the System

The ERP has 9 user roles, each with its own dashboard:

| Role | Department | Primary Responsibility in ERP |
|---|---|---|
| Sales Executive | Sales | Creates customer requirements and quotations |
| Operations Manager | Operations | Reviews requirements, approves quotations, manages equipment allocation |
| Warehouse Operator | Warehouse | Equipment inventory, goods receipt, stock status |
| Dispatch Coordinator | Operations | Assigns drivers/equipment, manages deliveries |
| Procurement Manager | Procurement | Purchase requests, purchase orders, vendors |
| **Finance Officer** | **Finance** | **Invoices, expenses, assets, approvals of quotations and procurement** |
| Maintenance Engineer | Maintenance | Equipment maintenance jobs |
| Head of IT | IT | System health, security, audit |
| Admin | Management/IT | Full system access, user management |

> **Note for Finance:** Today the system has a single "Finance Officer" role. One of the goals of this discovery is to determine whether Finance needs multiple roles (Finance Manager, Accountant, AP, AR) with different permissions — see Section 11.

### 2.2 The Master Flow: Opportunity to Completion

```
Customer Enquiry
      │
      ▼
1. REQUIREMENT created (Sales Executive)
   Status: Pending Review → Operations Review → Quotation In Progress
      │
      ▼
2. QUOTATION created (Sales Executive)
   • Line items priced in KWD, VAT %, discounts
   • Items are classified as:
       - "equipment"    → available from our own fleet
       - "procurement"  → must be purchased/leased first
   • If procurement items exist, a Procurement Request is AUTO-CREATED
   Status: Draft → Sent
      │
      ▼
3. QUOTATION APPROVAL (Finance Officer or Operations Manager)
   • Approve → status Approved; approved_by recorded
   • Reject  → status Rejected with mandatory reason; Sales notified
      │
      ▼
4. DISPATCH (job execution) — auto-created on approval
   • Fleet items dispatch immediately (Pending → Assigned → In Transit → Completed)
   • Procurement items wait until goods are received
      │
      ▼
5. PROCUREMENT (if required)
   Draft → Pending Approval → (Finance approves) → Approved → PO Issued → Received
   • On receipt, equipment is added to the fleet and held dispatches proceed
      │
      ▼
6. INVOICE (Finance Officer)
   • Created manually from the APPROVED quotation
   • Status: Draft → Sent → Paid / Overdue / Cancelled
   • Payment recorded by "Mark as Paid" (no receipt document today)
      │
      ▼
7. COMPLETION
   • Dispatches Completed; Requirement → Completed
   • No formal project closing / financial closing step exists today
```

### 2.3 Key Observations for Finance (Gaps in Today's System)

1. **No Proforma Invoice exists.** Invoicing goes straight from approved quotation to invoice.
2. **No partial / milestone / advance / retention invoicing.** One invoice per quotation, full amount.
3. **No payment receipt document.** Payments are a single "Mark as Paid" action; no partial payments, no allocation, no receipts.
4. **No budgets anywhere.** Procurement approval by Finance is a yes/no with no budget check behind it.
5. **No credit notes, debit notes, amendments, or formal cancellation process.**
6. **No General Ledger, journal entries, cost centres, or period closing.**
7. **Vendor side is thin.** POs exist with amounts, but there is no vendor invoice registration or vendor payment workflow — only an "expense" record Finance types in manually.
8. **No customer credit management** (credit limits, credit terms, statements, dunning).

Every one of these gaps is covered by a question in Section 17.

---

## 3. Workflow Catalogue

Each workflow below is described using a consistent structure: trigger, step-by-step process with owner, documents, approvals, status changes, notifications, validations, **accounting impact**, and completion conditions. Where the ERP does not yet implement a step, it is marked **[NOT BUILT — Finance input needed]**.

---

### 3.1 Workflow 1 — Standard Project (No Procurement)

A customer requests equipment/services that we can fulfil entirely from our own fleet.

**Trigger:** Customer enquiry received by Sales.

| # | Step | Owner / User | Inputs | Outputs / Documents | Status Change |
|---|---|---|---|---|---|
| 1 | Create Requirement | Sales Executive | Customer details, location, equipment needs, dates | Requirement record (REQ ID) | → Pending Review |
| 2 | Operations feasibility review | Operations Manager | Requirement, fleet availability | Reviewed requirement | → Operations Review |
| 3 | Prepare Quotation | Sales Executive | Requirement items, rates (KWD), VAT %, discounts, terms | **Quotation document** (line items, subtotal, VAT, total) | Requirement → Quotation In Progress; Quotation = Draft |
| 4 | Send Quotation for approval | Sales Executive | Draft quotation | Quotation sent internally | Quotation → Sent |
| 5 | **Approve Quotation** | **Finance Officer** or Operations Manager | Quotation detail, dispatch preview | Approval record (approved_by) | Quotation → Approved; Requirement → Quoted |
| 6 | Dispatches auto-created | System | Approved quotation items | Dispatch records per equipment item | Dispatch = Pending |
| 7 | Assign driver & equipment | Dispatch Coordinator | Dispatch, driver, equipment unit | Assignment | Dispatch → Assigned → In Transit; Equipment → Dispatched |
| 8 | Execute rental/project period | Operations | — | — | — |
| 9 | **Create Invoice** | **Finance Officer** | Approved quotation (pre-fills customer & amount), issue/due dates | **Tax Invoice (PDF)** | Invoice = Draft → Sent; Quotation → Invoiced |
| 10 | **Record payment** | **Finance Officer** | Payment confirmation, method | Payment marked | Invoice → Paid |
| 11 | Complete job | Operations / Dispatch | Return of equipment | — | Dispatch → Completed; Equipment → Available; Requirement → Completed |

**Notifications:** Quotation awaiting approval → Finance; rejection reason → Sales; chat thread messages ("Quote Created — {ID}").
**System validations today:** Invoice can only be created from an *Approved* quotation; amount pre-filled from quotation total.
**Accounting impact [NOT BUILT]:** Revenue recognition, VAT output liability, receivable creation, receipt entry — all to be defined by Finance.
**Completion conditions:** All dispatches Completed + Invoice Paid. *(Currently these are independent — there is no rule that a job cannot close with an unpaid invoice. Finance to confirm the desired rule.)*

**Finance discovery for this workflow:**
- The quotation becomes a "confirmed job" **at Finance/Operations approval** (step 5). Is that also the point of financial commitment (e.g., when a Proforma Invoice or advance request should be raised)?
- Should an invoice be creatable *before* dispatch completion (advance billing) or only *after* (billing in arrears)? Today it is possible at any time after approval.

---

### 3.2 Workflow 2 — Project Requiring Procurement

Items on the quotation are not in our fleet and must be purchased or leased first.

**Trigger:** Sales creates a quotation containing items flagged `procurement`.

| # | Step | Owner / User | Inputs | Outputs / Documents | Status Change |
|---|---|---|---|---|---|
| 1–4 | Same as Workflow 1 steps 1–4 | Sales | — | Quotation | — |
| 5 | **Procurement Request auto-created** by the system at quotation creation | System | Procurement-type line items, required-by date | Procurement Request ("Procurement for Quotation {ID}") | Procurement = Draft |
| 6 | Quotation approved | **Finance Officer** / Operations Manager | Quotation | Approval; fleet-item dispatches created; procurement-item dispatches **held** | Quotation → Approved |
| 7 | Submit procurement for approval | Procurement Manager | Procurement request, priority | Submitted request | Procurement → Pending Approval |
| 8 | **Approve procurement** | **Finance Officer** (or Admin) | Request details, amount | Approval | Procurement → Approved |
| 9 | Issue Purchase Order | Procurement Manager | Vendor, prices, delivery date | **Purchase Order (PO number, total KWD)** | Procurement → PO Issued; PO = Draft → Submitted → Acknowledged |
| 10 | Goods receipt | Warehouse Operator / Procurement | Delivery, serial numbers | Goods receipt (received qty/date); equipment units auto-created in fleet | Procurement → Received; PO → Delivered; Equipment = Available |
| 11 | Held dispatches released | System / Dispatch Coordinator | Received equipment | Dispatches proceed | Dispatch → Pending → Assigned … |
| 12 | **Record procurement expense** | **Finance Officer** | PO link (auto-fills vendor & amount), payment method/date | Expense record | — |
| 13 | Customer invoicing & payment | **Finance Officer** | As Workflow 1 steps 9–10 | Tax Invoice | Invoice lifecycle |

**Validations today:** Dispatches for procurement-sourced items cannot proceed until goods are received.
**Accounting impact [NOT BUILT]:** PO commitment vs. actual cost, vendor payable creation on receipt or vendor invoice, project cost allocation, margin tracking (quotation revenue vs. procurement cost).
**Finance discovery:**
- Should Finance approval of the procurement be **conditional on the customer quotation being approved first**? Today procurement can be approved independently.
- Is there a **budget or margin check** before Finance approves procurement (e.g., procurement cost must not exceed X% of quotation value)?
- Should the vendor's invoice be a formal registered document (3-way match: PO ↔ Goods Receipt ↔ Vendor Invoice) rather than the current free-typed expense?

---

### 3.3 Workflow 3 — Equipment Rental Workflow

Two distinct rental directions exist:

**A. We rent OUT our equipment to a customer** — this *is* Workflow 1 (dispatch-based rental with rental_start/end dates on quotation items).

**B. We rent IN (lease) equipment from a vendor:**

| # | Step | Owner / User | Documents | Status |
|---|---|---|---|---|
| 1 | Procurement request of type **Lease** | Procurement Manager (or auto from quotation) | Procurement Request | Draft → Pending Approval |
| 2 | Finance approves | **Finance Officer** | Approval | Approved |
| 3 | PO issued to lessor | Procurement Manager | Purchase Order | PO Issued |
| 4 | Equipment received; lease dates recorded | Warehouse | Equipment unit with `lease_start_date`, `lease_end_date`, daily rate | Equipment = Available |
| 5 | **Lease Invoice created per period** | **Finance Officer** | Equipment, period start/end; system suggests amount = days × daily rate | **Lease Invoice** | Draft → Sent → Paid |
| 6 | Lease expiry monitoring | System | Alerts: red = expired, orange = expiring within 14 days | — |
| 7 | Lease extension | Operations / Procurement | Lease Extension record (old end date → new end date, monthly rate) | — |
| 8 | Lease return | Warehouse | Return date, returned-by, notes | Equipment leased-return recorded |

**Finance discovery:**
- Lease invoices today are *our record of what we owe the lessor* — should these instead be registered **vendor invoices** entering an Accounts Payable process with approval and scheduled payment?
- Who approves a lease extension, and does it require a revised financial commitment/budget?
- Are lease costs charged to the project that uses the equipment (cost allocation), or held as a general expense?

---

### 3.4 Workflow 4 — Service Contract Workflow **[NOT BUILT]**

The ERP has no contract entity today. A service engagement would be modelled as a requirement + quotation. Finance must define:

- **How the workflow begins:** signed contract? accepted quotation? LPO from customer?
- **Billing pattern:** monthly in advance / arrears, quarterly, milestone-based?
- **Documents:** contract record, billing schedule, recurring invoices, renewal notices.
- **Approvals:** who approves contract pricing and renewals; whether Finance signs off on payment terms.
- **Status model (proposed):** Draft → Active → Suspended → Expired → Renewed → Terminated.
- **Accounting impact:** deferred revenue for advance billing; unbilled revenue for arrears; renewal escalation clauses.
- **Completion:** contract end date reached, all invoices issued and settled.

*(See Questionnaire §17.2 Q10–Q13.)*

---

### 3.5 Workflow 5 — Material Supply Workflow **[PARTIALLY BUILT]**

Supplying materials (rather than renting equipment) to a customer. Today this can only be expressed as procurement-type quotation items (buy → receive → deliver). Finance must define:

- Whether material sales follow the same quotation → invoice flow, or need a **Delivery Note / Sales Order** document between approval and invoice.
- Whether invoicing is on **delivery** (with proof of delivery) or on order confirmation.
- Whether **partial deliveries** produce partial invoices.
- Inventory valuation: cost of goods sold entries, stock valuation method (FIFO/average) — none exists today.
- Completion: full delivery + full invoicing + payment.

---

### 3.6 Workflow 6 — Maintenance Contract Workflow **[PARTIALLY BUILT]**

Maintenance jobs exist operationally (Maintenance Engineer role, maintenance status on equipment), but with **no financial layer**:

- **Internal maintenance** of our fleet: costs recorded only as generic "Maintenance" expenses. Finance to define whether costs must be tracked per equipment unit (asset maintenance history affecting depreciation/valuation).
- **Customer maintenance contracts** (we maintain a customer's equipment for a fee): not modelled. Finance to define contract billing (fixed periodic fee vs. per-callout billing), spare-parts billing (cost-plus? list price?), and approval of chargeable vs. warranty work.
- Completion: job closed by Maintenance Engineer; Finance sign-off needed?

---

### 3.7 Workflow 7 — Emergency Purchase Workflow

Today the system supports only a **priority flag** (Low / Normal / High / Urgent) on procurement requests — the approval path is identical regardless of priority.

**Finance must define the real emergency process:**

| Question | Options to confirm |
|---|---|
| Can purchase happen **before** approval? | Yes with retroactive approval / No, but fast-tracked approval |
| Who can authorise an emergency purchase? | Operations Manager verbally? GM? Finance on-call? |
| Spending limit for emergency purchases without full approval | e.g., up to KWD 500? |
| Documentation required afterwards | Retroactive PR + PO? Petty cash voucher? |
| Payment method | Petty cash, company card, cash advance? |
| Accounting impact | Direct expense vs. normal PO/GRN/invoice matching |

**Proposed status model:** Emergency Requested → Verbally Authorised → Purchased → Retroactive PO → Regularised → Closed.

---

### 3.8 Workflow 8 — Customer Credit Workflow **[NOT BUILT]**

No credit management exists. Customers have no credit limit, credit terms, or account statement. Finance to define:

1. **Credit terms:** standard terms (e.g., Net 30)? Per-customer terms? Who sets them?
2. **Credit limits:** per customer? Who approves a limit and increases?
3. **Credit check on quotation approval:** should the system block or warn when a customer's outstanding balance + new quotation exceeds their limit? Who can override (GM? Finance Manager)?
4. **Account statement:** monthly statements? On demand?
5. **Dunning / reminders:** reminder schedule (e.g., due date, +7, +14, +30 days), escalation to Sales/Management, service suspension for defaulting customers.
6. **Blocking rules:** can Sales create requirements for a blocked customer? Can Operations dispatch to an over-limit customer?
7. **Accounting impact:** provision for doubtful debts, bad-debt write-off approval.

---

### 3.9 Workflow 9 — Project Change Order Workflow **[NOT BUILT]**

Today, changing an approved quotation has no defined process — the quotation is either approved or a new one is made.

Finance to define:

- **Trigger:** customer requests scope change (more equipment, extended rental period, different items) after approval.
- **Document:** revised quotation (versioned)? Formal Change Order / Variation Order document?
- **Approvals:** does a change re-enter the full approval chain? Different thresholds for increases vs. decreases?
- **Invoicing impact:** supplementary invoice for additions? Credit note for reductions? Amend original invoice if not yet sent?
- **Dispatch impact:** system must add/cancel/extend dispatches accordingly.
- **Budget impact:** revised project budget approval if cost increases.
- **Rental extensions:** extending a rental period is the most common change — should this be a lightweight flow (Operations extends, Finance auto-notified, invoice recalculated)?

---

### 3.10 Workflow 10 — Project Cancellation Workflow **[NOT BUILT]**

Requirements and quotations have a `Cancelled` status, but there is no defined cancellation process with financial consequences. Finance to define:

| Cancellation point | Financial consequence to confirm |
|---|---|
| Before quotation approval | None? Simply mark cancelled |
| After approval, before dispatch | Cancellation fee? Cancel held procurement? What if PO already issued to a vendor? |
| After dispatch (equipment on site) | Pro-rata billing for days used? Mobilisation/demobilisation charges? |
| After invoicing, before payment | Cancel invoice? Credit note? |
| After payment | Refund process, credit-on-account |
| Procurement already received for the project | Goods to stock? Return to vendor? Restocking fees? |

**Approvals:** who can cancel a confirmed job (Sales? Operations? GM?) and who approves the financial settlement (Finance Manager)?
**Accounting impact:** reversal of revenue, refund entries, write-off of unrecoverable procurement cost.

---

### 3.11 Workflow 11 — Vendor Purchase Workflow (Standalone)

Procurement not tied to a customer quotation — fleet expansion, spare parts, consumables.

| # | Step | Owner | Documents | Status |
|---|---|---|---|---|
| 1 | Create purchase request | Procurement Manager (also Operations Manager, Admin) | Procurement Request (type Purchase/Lease, priority, required-by date) | Draft |
| 2 | Submit | Procurement Manager | — | Pending Approval |
| 3 | **Approve** | **Finance Officer** / Admin | Approval record | Approved |
| 4 | Issue PO | Procurement Manager (Finance Officer can also create POs) | Purchase Order (number, vendor, total KWD, expected delivery) | PO Issued; PO Draft → Submitted → Acknowledged |
| 5 | Goods receipt | Warehouse Operator | Received qty/date/location; equipment auto-added to fleet | Received / Partially Delivered → Delivered |
| 6 | **Vendor invoice [GAP]** | — | *No vendor invoice registration exists* | — |
| 7 | **Record expense** | **Finance Officer** | Expense record (category, amount, payment method, linked PO) | — |
| 8 | **Vendor payment [GAP]** | — | *No payment scheduling, approval, or partial payments* | — |

**Vendor master data:** name, contact, payment terms (free text), active flag. No bank details, tax registration, or credit terms structure.
**Finance discovery:** the entire AP cycle (vendor invoice registration → 3-way match → payment approval → payment run → remittance) must be specified by Finance. See Questionnaire §17.6.

---

### 3.12 Workflow 12 — Project Closing Workflow **[NOT BUILT]**

Today "closing" is implicit: dispatches Completed and requirement marked Completed. There is no financial closing gate. Finance to define:

**Proposed closing checklist (to validate):**
1. All dispatches completed and equipment returned.
2. All procurement for the project received and vendor costs recorded.
3. All customer invoices issued (including final/retention invoices).
4. All customer payments received *or* balance formally accepted as receivable/written off.
5. All vendor invoices for the project paid or accrued.
6. Project profitability report generated (revenue vs. cost).
7. **Finance sign-off** → project financially closed; no further postings allowed.

**Questions:** Who initiates closing (PM/Operations)? Who signs off (Finance Manager)? Can a closed project be reopened, and who approves that? Is there a WIP (work-in-progress) concept for month-end on open projects?

---

## 4. Finance Workflow Integration Points

Summary of every point where Finance touches the current system, and the decisions needed:

| # | Integration point | Current behaviour | Finance decision needed |
|---|---|---|---|
| F1 | **Quotation approval** | Finance Officer (or Operations Manager) approves/rejects | Should Finance approval be mandatory (not either/or)? Thresholds by value? Credit check at this point? |
| F2 | **Job confirmation** | Quotation Approved = confirmed job | Is customer LPO/PO required before confirmation? Advance payment before dispatch? |
| F3 | **Proforma Invoice** | Does not exist | Is one required? Created by whom (Finance only? on Sales/Ops request?)? Approved by whom? Conditions (always / on customer request / for advance payment)? |
| F4 | **Tax Invoice creation** | Finance manually creates from approved quotation, any time | Trigger rules, generated from proforma?, multiple/partial/milestone/advance/retention invoices? |
| F5 | **Procurement approval** | Finance Officer approves procurement requests | Budget verification behind approval? Value thresholds? |
| F6 | **Expense recording** | Finance types expenses, optionally linked to PO | Replace with formal vendor invoice + payment workflow? |
| F7 | **Lease invoices** | Finance records periodic lease amounts owed to lessors | Move into AP workflow? Auto-generate per period? |
| F8 | **Payment recording** | Single "Mark Paid" click | Full receipt workflow: partial payments, allocation, methods, bank reconciliation |
| F9 | **Asset registry** | Manual asset list with depreciation % | Auto-capitalise purchased equipment? Depreciation postings? |
| F10 | **Z Report** | On-demand PDF summary of revenue/expenses/equipment | Which periodic reports does Finance actually need? |

---

## 5. Invoice Lifecycle

### 5.1 Current State

```
Approved Quotation ──▶ Invoice (Draft) ──▶ Sent ──▶ Paid
                                   │                └─▶ Overdue
                                   └─▶ Cancelled (no rules attached)
```

- One invoice per quotation, full amount, pre-filled from quotation total.
- PDF generated in-app. No invoice numbering scheme confirmed with Finance.
- "Overdue" is a manually-set status — no automatic overdue detection is implemented.
- Cancellation is just a status change: no reason capture, no credit note, no numbering audit.

### 5.2 Decisions Required from Finance

**Proforma Invoice**
- When is a Proforma Invoice created, and under what conditions (advance payment request? customer requirement? customs/import)?
- Who creates it — Finance independently, or on request from Sales/Operations? Can Sales or Operations trigger the request in the ERP?
- Who approves it before it is sent to the customer?
- Does the Tax Invoice get generated **from** the Proforma (carrying its lines), or independently from the quotation?

**Tax Invoice**
- Exact trigger: on job confirmation, on dispatch, on delivery, on completion, per milestone, per calendar period (for long rentals)?
- Are **multiple invoices per quotation/job** allowed? Are **partial invoices** allowed?
- Does **milestone billing** exist (e.g., 40% mobilisation / 40% progress / 20% completion)?
- Do **advance invoices** exist, and how is the advance adjusted against later invoices?
- Do **retention invoices** exist (e.g., 10% retained, invoiced after defect liability period)?
- Invoice numbering: format, sequence, per-year reset, legal requirements? Can a number ever be reused or a gap exist?

**Approval, Cancellation, Amendment**
- Does an invoice require internal approval before being sent (who — Finance Manager)? Above what value?
- Cancellation: who approves, must a reason be recorded, is a **Credit Note** mandatory once an invoice has been sent to the customer?
- Amendment: can a Sent invoice be edited at all, or only corrected via Credit/Debit Note?
- **Credit Note process:** triggers (returns, overbilling, cancellation, disputes), numbering, approval, effect on customer balance.
- **Debit Note process:** triggers (underbilling, penalties, extra charges), approval, numbering.

---

## 6. Budget Workflow

**Nothing exists today.** Procurement approval is not backed by any budget check. Finance to define the entire model:

| Topic | Questions |
|---|---|
| Budget types | Department budgets? Project budgets? Both? Annual company budget? |
| Project budgets | Who allocates (Finance from quotation cost estimate? PM proposes, Finance approves?) and **when** (at quotation approval? at job confirmation?) |
| Structure | Single figure per project, or broken down (equipment, procurement, labour, transport, misc)? Can one project have multiple budgets/phases? |
| Review cadence | Monthly? At each procurement request? Real-time committed-vs-actual? |
| Revision | Can budgets be revised? Who approves increases (Finance Manager to X, GM above X, MD above Y)? |
| Enforcement | When a purchase would exceed budget: hard block, warning + override with approval, or notify-only? Who can override? |
| Overrun handling | What happens when a project exceeds budget — escalation path, mandatory review meeting, freeze on further procurement? |
| Commitment accounting | Should issued POs count as "committed" against budget before goods/invoice arrive? *(Recommended — the Procurement dashboard already shows "Budget Committed (KWD)" as a KPI, currently derived from PO totals only.)* |

---

## 7. Procurement Workflow & Finance Integration

### 7.1 Current Chain

```
Purchase Request (Draft)
  → Submitted (Pending Approval)          [Procurement Manager]
    → Approved / Rejected                 [Finance Officer or Admin]
      → PO Issued                         [Procurement Manager or Finance Officer]
        → PO: Draft → Submitted → Acknowledged → Partially Delivered → Delivered
          → Goods Receipt                 [Warehouse]  (equipment auto-added to fleet)
            → Expense recorded            [Finance Officer]  ← informal, manual
```

Requests may also be **auto-created** when a Sales quotation contains non-fleet items.

### 7.2 What Finance Must Specify

1. **Budget verification before approval** — see Section 6.
2. **Approval hierarchy by value** — e.g., Finance Officer to KWD 1,000; Finance Manager to 5,000; GM to 25,000; MD above. Confirm actual bands.
3. **Vendor Invoice workflow** — registration of the supplier's invoice, matching against PO and Goods Receipt (3-way match), tolerance for price/quantity variances, approval of mismatches.
4. **Vendor Payment workflow** — payment request → approval → scheduling per payment terms → execution (bank transfer/cheque) → remittance advice → partial payments.
5. **Emergency procurement** — see Workflow 7.
6. **Advance payments to vendors** — down-payments against POs, and their settlement against the final vendor invoice.
7. **Vendor master governance** — who approves new vendors, required data (bank details, tax registration, trade licence), inactive/blacklisted vendors.

---

## 8. Payment Lifecycle

### 8.1 Customer Payments — All to Be Defined

Current state: one "Mark as Paid" button; `amount_paid_kwd` is set equal to the invoice total; a payment date and method are stored. **No partial payments, no receipts, no allocation.**

Finance to define:

| Topic | Questions |
|---|---|
| Advance payment | Is an advance required before dispatch? Percentage? Against Proforma? How is it receipted and later adjusted? |
| Partial payment | Allowed? Recorded per receipt with running balance? Minimum instalment rules? |
| Final payment | Triggers job/financial closure? Retention withheld? |
| Outstanding balance | Aging buckets (current / 30 / 60 / 90+)? Interest or late penalties? |
| Payment reminders | Automatic reminder schedule and channels (email? statement?)? Who follows up — Finance (AR) or Sales? |
| Payment allocation | When a customer pays a lump sum across several invoices: oldest-first automatic, or manual allocation? Can a payment sit unallocated ("on account")? |
| Receipt document | Is a formal numbered Receipt Voucher issued for every payment? |
| Methods | Bank transfer, cheque (incl. post-dated cheque tracking?), cash, card, online — which are accepted, and are cheques recorded before clearing? |

### 8.2 Vendor Payments — All to Be Defined

| Step | Questions |
|---|---|
| Payment request | Raised automatically when vendor invoice falls due, or manually by AP? |
| Approval | Who approves payment release, and at what value thresholds? |
| Scheduling | Weekly payment runs? Per payment terms? Early-payment discounts? |
| Partial payment | Allowed against a vendor invoice? |
| Final payment | Closes the PO / procurement financially |
| Documents | Payment Voucher, remittance advice, cheque register |

---

## 9. Accounting Workflow

None of the following exists. Finance must specify each area:

| Area | Questions for Finance |
|---|---|
| **Chart of Accounts / GL** | Provide the chart of accounts. Should the ERP post entries automatically from documents (invoice → Dr AR / Cr Revenue / Cr VAT), or export to an external accounting system? Which accounting software is used today? |
| **Journal entries** | Are manual journal entries needed inside the ERP? Who can post them, who approves? |
| **Cost centres** | List required cost centres (departments? equipment categories?). Is every expense assigned to one? |
| **Profit centres** | Is each project/job a profit centre? Business lines (rental vs. supply vs. maintenance)? |
| **Tax / VAT-GST** | Current tax regime and rates applicable in Kuwait for our business. Which items/services are taxable, zero-rated, exempt? Tax on vendor side (withholding?)? Legal invoice content requirements. |
| **Multi-currency** | Do we quote, invoice, or pay in any currency other than KWD (USD vendor POs?)? If yes: rate source, rate date rules (document date vs. payment date), realised/unrealised FX gain-loss handling. |
| **Period closing** | Month-end checklist: what must be completed before a month closes (all invoices posted, expenses recorded, lease invoices raised, depreciation run, reconciliations)? Can documents be back-dated into a closed period? Who reopens a period? |
| **Year-end** | Year-end additional steps: depreciation finalisation, provisions, retained earnings, audit adjustments. Fiscal year dates. |
| **Depreciation** | The asset register stores a % rate. Method (straight-line?), posting frequency, who runs it, disposal handling. |
| **Revenue recognition** | Point-in-time on invoice, or over the rental period? Deferred/unbilled revenue treatment for long rentals spanning month-end. |

---

## 10. Reports Required

Finance to confirm which reports are needed, their frequency, and who receives them:

| Report | Exists today? | Notes |
|---|---|---|
| Profit & Loss | No | Requires GL/cost structure |
| Balance Sheet | No | Requires GL |
| Cash Flow | No | Requires payments module |
| Budget vs Actual | No | Requires budgets (Section 6) |
| Outstanding Receivables | Partial (dashboard "Outstanding KWD" figure) | Needs per-customer detail |
| Outstanding Payables | No | Requires AP module |
| Receivables/Payables Aging | No | Confirm buckets |
| Vendor reports (spend by vendor, PO history) | Partial (procurement dashboard) | |
| Customer reports (revenue by customer, statements) | No | |
| Project Profitability (revenue vs. cost per job) | No | High value — confirm cost components |
| Expense report by category | Partial (expense totals by category) | |
| Revenue reports (by period, by business line) | Partial (billed/collected bars) | |
| Z Report (period summary PDF) | **Yes** | Confirm whether this matches a real business need or should be replaced |
| VAT/tax return support report | No | Depends on tax regime |

For each report Finance should specify: **frequency, filters (period/customer/project), level of detail, export format (PDF/Excel), and audience.**

---

## 11. Roles & Responsibilities (RACI Matrix)

Roles in **bold** do not exist in the system yet — Finance to confirm whether they are needed as distinct ERP roles or covered by the single "Finance Officer" role.

R = Responsible, A = Accountable, C = Consulted, I = Informed

| Activity | Sales Exec | Ops Mgr | Proc Mgr | Warehouse | Finance Officer | **Finance Mgr** | **Accountant** | **AP Clerk** | **AR Clerk** | **GM** | **MD** |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Create requirement | R/A | C | | | | | | | | I | |
| Prepare quotation | R | C | | | C | | | | | | |
| Approve quotation | I | A? | | | R? | A? | | | | C? | |
| Confirm job / customer PO | R | I | | | C | A? | | | | | |
| Create Proforma Invoice | C? | C? | | | R? | A? | | | R? | | |
| Create Tax Invoice | I | I | | | R | A | | | R? | | |
| Approve invoice before sending | | | | | | A? | | | | C? | |
| Record customer payment | I | | | | R | I | | | R? | | |
| Payment reminders / dunning | C | | | | R? | A | | | R? | I | |
| Raise purchase request | | C | R/A | C | | | | | | | |
| Approve purchase request | | C | I | | R? | A? | | | | C? | C? |
| Issue PO | | | R | | C | A? | | | | | |
| Goods receipt | | I | C | R/A | I | | | | | | |
| Register vendor invoice | | | C | C | R? | | R? | R? | | | |
| Approve vendor payment | | | I | | | A? | | R? | | C? | C? |
| Execute vendor payment | | | I | | R? | A | | R? | | | |
| Allocate project budget | | C | | | | R/A? | | | | C? | |
| Approve budget increase | | C | | | | R? | | | | A? | A? |
| Credit limit approval | C | | | | | R? | | | R? | A? | |
| Credit/Debit note approval | I | | | | R? | A? | | | | C? | |
| Manual journal entry | | | | | | A? | R? | | | | |
| Month-end close | | | | | C | A | R? | C | C | I | |
| Project financial closing | I | C | | | R? | A? | | | | I | |
| Write-off / bad debt | | | | | | C | | | R? | A? | A? |

*Every "?" is a question for Finance — the questionnaire (Section 17.11) collects these answers.*

---

## 12. Approval Matrix

Current approvals in the system, plus proposed approvals for Finance to complete with real thresholds:

| Document / Action | Current approver | Proposed threshold model (to confirm) |
|---|---|---|
| Quotation | Finance Officer **or** Operations Manager (either) | ≤ KWD ___ : Ops OR Finance · > KWD ___ : both · > KWD ___ : + GM |
| Proforma Invoice | — (doesn't exist) | Finance Manager? |
| Tax Invoice | None (Finance creates & sends directly) | ≤ KWD ___ : none · > KWD ___ : Finance Manager |
| Invoice cancellation / Credit Note | None | Finance Manager always? GM above KWD ___? |
| Purchase Request | Finance Officer / Admin | Bands: Finance Officer ≤ ___, Finance Mgr ≤ ___, GM ≤ ___, MD > ___ |
| Purchase Order | None beyond request approval | Same bands as request? Separate PO approval? |
| Emergency purchase | — | Verbal by ___ up to KWD ___, regularised within ___ days |
| Vendor payment | — | AP prepares, Finance Mgr approves ≤ ___, GM > ___ |
| Budget allocation | — | Finance Manager |
| Budget increase | — | Finance Mgr ≤ __% over, GM ≤ __%, MD above |
| Credit limit | — | Finance Mgr ≤ KWD ___, GM above |
| Write-off / bad debt | — | GM ≤ KWD ___, MD above |
| Manual journal | — | Accountant posts, Finance Mgr approves |
| Period close / reopen | — | Finance Manager close; reopen by Finance Mgr + reason logged |
| Project financial closing | — | Finance Manager |
| Refund to customer | — | Finance Mgr ≤ ___, GM above |

---

## 13. Document Lifecycle

Every document in the end-to-end process, its current state, and its lifecycle:

| # | Document | Created by | Status flow | Exists? |
|---|---|---|---|---|
| 1 | Requirement | Sales Executive | Pending Review → Operations Review → Quotation In Progress → Quoted → Approved → Completed / Cancelled / Rejected | ✅ |
| 2 | Quotation | Sales Executive | Draft → Sent → Approved / Rejected / Expired → Invoiced | ✅ |
| 3 | Customer LPO / PO (received) | Customer → recorded by Sales | — | ❌ (not captured) |
| 4 | **Proforma Invoice** | Finance (TBC) | Draft → Approved → Sent → Converted / Cancelled (proposed) | ❌ |
| 5 | Dispatch / Delivery Note | System / Dispatch Coordinator | Pending → Assigned → In Transit → Completed | ✅ (no printable delivery note) |
| 6 | **Tax Invoice** | Finance Officer | Draft → Sent → Paid / Overdue / Cancelled | ✅ UI only |
| 7 | **Receipt Voucher** | Finance (TBC) | Issued → (Cheque: Pending Clearance → Cleared / Bounced) (proposed) | ❌ |
| 8 | **Credit Note** | Finance (TBC) | Draft → Approved → Issued → Applied (proposed) | ❌ |
| 9 | **Debit Note** | Finance (TBC) | Draft → Approved → Issued (proposed) | ❌ |
| 10 | Purchase Request | Procurement Manager | Draft → Pending Approval → Approved → PO Issued → Received / Rejected / Cancelled | ✅ |
| 11 | Purchase Order | Procurement Manager | Draft → Submitted → Acknowledged → Partially Delivered → Delivered | ✅ |
| 12 | Goods Receipt Note | Warehouse | Received qty/date recorded | ✅ (data only, no formal GRN document) |
| 13 | **Vendor Invoice** | AP (TBC) | Registered → Matched → Approved → Scheduled → Paid (proposed) | ❌ |
| 14 | **Payment Voucher** | AP (TBC) | Draft → Approved → Paid (proposed) | ❌ |
| 15 | Lease Invoice | Finance Officer | Draft → Sent → Paid / Cancelled | ✅ UI only |
| 16 | Lease Extension | Operations/Procurement | Recorded (old end → new end) | ✅ |
| 17 | Expense record | Finance Officer | Recorded | ✅ (to be replaced by 13–14?) |
| 18 | Asset record | Finance Officer | Registered → (Depreciating → Disposed proposed) | ✅ partial |
| 19 | **Budget** | Finance (TBC) | Draft → Approved → Active → Revised → Closed (proposed) | ❌ |
| 20 | **Journal Entry** | Accountant (TBC) | Draft → Approved → Posted (proposed) | ❌ |
| 21 | **Project Closing Certificate** | Finance (TBC) | Checklist complete → Signed off (proposed) | ❌ |
| 22 | Z Report / period reports | Finance Officer | Generated on demand | ✅ |

---

## 14. Exception Handling Matrix

For every exception: current system behaviour and what Finance must define.

| # | Exception | Current behaviour | Finance must define |
|---|---|---|---|
| 1 | Procurement rejected | Status → Rejected; no downstream handling | Effect on the customer quotation that depends on it (re-quote? cancel? alternative vendor?) — who informs Sales |
| 2 | Budget exceeded | N/A (no budgets) | Block vs. override; approver; escalation |
| 3 | Budget unavailable | N/A | Can a PR even be submitted without budget? |
| 4 | Budget revised | N/A | Approval chain; effect on pending PRs |
| 5 | Duplicate invoice | Nothing prevents it | Duplicate detection rule (same quotation + overlapping amount?); resolution via cancellation/credit note |
| 6 | Incorrect invoice | Editable while Draft; no rule after Sent | Amendment policy: correct Draft freely; after Sent only via Credit/Debit Note? |
| 7 | Invoice cancelled | Status change only | Reason mandatory; approval; credit note if already sent; number retained for audit |
| 8 | Customer dispute | Not modelled | Dispute flag on invoice pausing dunning; resolution owner; credit note or reissue |
| 9 | Vendor dispute | Not modelled | Hold payment; dispute log; resolution before payment release |
| 10 | Project cancelled | Status only | Full settlement rules — see Workflow 10 |
| 11 | Project on hold | Not modelled | New status; billing paused? equipment recalled? standby charges? |
| 12 | Partial delivery (vendor) | PO status "Partially Delivered" exists | Pay per received portion? Wait for completion? Backorder handling |
| 13 | Partial procurement | Items individually receivable | Dispatch released per item (current) — Finance cost recognition per receipt |
| 14 | Partial billing | Not supported | Allowed? Rules per Section 5 |
| 15 | Partial payment | Not supported | Rules per Section 8 |
| 16 | Missing approvals | Action simply waits | SLA / reminder escalation (e.g., escalate after N days); delegate approvers during absence |
| 17 | Approval rejected | Status Rejected + reason (quotations) | Standardise: every rejection requires reason + notification + defined re-submission path |
| 18 | Price change (vendor, after PO) | Not handled | PO amendment approval; variance tolerance (accept ≤ _%, re-approve above) |
| 19 | Vendor unavailable | Not handled | Re-source process; effect on committed quotation dates; who informs Sales/customer |
| 20 | Material shortage | Not handled | Substitute item approval; partial fulfilment; customer notification |
| 21 | Tax change | Manual VAT entry | Effective-date tax configuration; which rate applies to documents spanning the change |
| 22 | Currency fluctuation | Single currency | Only if multi-currency confirmed — rate policy, FX gain/loss |
| 23 | Credit limit exceeded | N/A | Block/warn at quotation approval; override authority |
| 24 | Customer default | N/A | Dunning escalation → service suspension → legal → provision → write-off |
| 25 | Vendor refund | N/A | Vendor credit note registration; offset vs. cash refund |
| 26 | Customer refund | N/A | Approval; refund voucher; method |
| 27 | Advance adjustment | N/A | Auto-apply advance to subsequent invoices? Manual? Refund of unused advance |
| 28 | Retention release | N/A | Trigger (defect period end / customer certificate); who initiates; retention invoice |
| 29 | Payment delay | Status "Overdue" (manual) | Auto-overdue on due date; grace period; reminder schedule |
| 30 | Late payment penalties | N/A | Charged? Rate? Via debit note? Approval to waive |
| 31 | Write-offs | N/A | Threshold-based approval; GL treatment |
| 32 | Bad debt | N/A | Provision policy; write-off approval; recovery handling |
| 33 | Manual journal entries | N/A | Permitted users; approval; closed-period restriction |
| 34 | **Bounced cheque** *(additional)* | N/A | Reverse receipt; reinstate invoice balance; penalty; customer flag |
| 35 | **Lease expired while equipment on customer site** *(additional)* | Expiry alert only | Auto-extension request? Financial exposure alert |
| 36 | **Equipment damaged/lost on hire** *(additional)* | Maintenance status only | Charge customer? Insurance claim workflow? Asset write-down |
| 37 | **Quotation expired after customer acceptance** *(additional)* | Status Expired | Revalidation approval; price honouring policy |
| 38 | **Goods received without PO** *(additional)* | Possible via manual expense | Should this be blocked? Regularisation process |
| 39 | **Rounding differences / petty balances** *(additional)* | N/A | Auto write-off below KWD ___? |

---

## 15. Risks and Assumptions

### Assumptions (to be validated by Finance)

| # | Assumption |
|---|---|
| A1 | KWD is the only operating currency (3 decimal places) |
| A2 | The company operates on a single legal entity (no inter-company transactions) |
| A3 | Quotation approval is the point at which a job is financially committed |
| A4 | Equipment rental is the primary revenue stream; supply and maintenance are secondary |
| A5 | Finance requires the ERP to be the system of record for AR/AP (not just an operational front-end to an external accounting package) |
| A6 | The current "Finance Officer" role will be split into multiple finance roles |
| A7 | Invoices are issued per job (quotation), not consolidated per customer per month |
| A8 | Existing UI screens (Invoices, Lease Invoices, Expenses, Assets, Z Report) broadly reflect the intended scope, subject to gaps identified here |

### Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Building invoice logic before Finance confirms invoice types (proforma/advance/partial/retention) forces rework of the data model | Complete Sections 5 & 17.3 first |
| R2 | No budget model means procurement approvals carry no financial control | Prioritise Section 6 answers |
| R3 | Historic invoices already created via the UI may not comply with future numbering/tax rules | Migration/renumbering plan needed |
| R4 | External accounting system integration unknown — could invalidate the GL design | Answer §17.7 Q1–Q3 before accounting design |
| R5 | Single approver ("Finance Officer") is a key-person dependency and weak segregation of duties | Define role split + delegation rules |
| R6 | Tax regime changes in Kuwait (e.g., VAT introduction) could occur mid-build | Tax must be configurable by rate + effective date, not hard-coded |
| R7 | Auto-created procurement from quotations may commit spend before the customer confirms | Decide ordering rule (F2/§3.2) early |

---

## 16. Open Questions (Critical Path)

The ten questions whose answers most affect the technical design — answered first, everything else can proceed in parallel:

1. Does the company use an external accounting system today (which one), and must the ERP integrate with it or replace it?
2. Is a Proforma Invoice part of the real process, and is advance payment required before dispatch?
3. Are partial/milestone/multiple invoices per job required?
4. Are partial customer payments and payment allocation across invoices required?
5. Must budgets exist per project, per department, or both — and is budget checking blocking or advisory?
6. What are the approval value thresholds (quotation, procurement, payment) and who approves at each band?
7. Should vendor invoices become formal registered documents with 3-way matching and a payment approval workflow?
8. How many distinct Finance roles are needed, and what can each do?
9. What is the applicable tax regime and the legal requirements for a valid Tax Invoice in Kuwait?
10. Is multi-currency needed anywhere (even vendor-side)?

---

## 17. Finance Department Questionnaire

> **Instructions:** Please answer in plain business language. Where a question does not apply, write "N/A" and briefly say why. Where a process differs by situation, describe each variant. Attach sample documents (real invoices, credit notes, payment vouchers, statements) wherever possible — samples are the fastest way for us to get formats right.

### 17.1 Current Business Process

1. Walk us through what happens today, outside the ERP, from the moment Sales wins a job until the money is in the bank. Which steps happen on paper, in Excel, or in another system?
2. Which accounting or finance software do you use today? What must stay in that system vs. move into the ERP?
3. At what moment do you consider a quotation to be a "confirmed job" — customer signature, customer LPO, advance payment received, or something else?
4. Do you require a customer Purchase Order / LPO before any work begins? Should the ERP store it?
5. What is the very first financial document you create for a new job today, and when?

### 17.2 Document Lifecycle & Contracts

6. List every financial document you issue to customers (proforma, tax invoice, receipt, credit note, statement, etc.) with a sample of each.
7. List every financial document you receive/process from vendors.
8. What numbering format does each document use? Are sequences annual? Are gaps ever acceptable?
9. How long must each document be retained, and in what form (signed hard copy? PDF)?
10. Do you have service or maintenance contracts with recurring billing? How are they billed (monthly/quarterly, advance/arrears)?
11. How are contract renewals and price escalations handled?
12. For material supply, do you issue delivery notes, and is the invoice tied to proof of delivery?
13. For long rentals spanning several months, do you invoice monthly, at the end, or otherwise?

### 17.3 Invoice Lifecycle

14. Do you issue Proforma Invoices? If yes: under what conditions, who prepares them, who approves them, and can Sales or Operations request one?
15. When exactly is the Tax Invoice issued (on confirmation, delivery, completion, milestone, month-end)?
16. Is the Tax Invoice generated from the Proforma, from the quotation, or created fresh?
17. Can one job have multiple invoices? Can an invoice cover part of a job (partial invoice)?
18. Do you use milestone billing (e.g., % on mobilisation / progress / completion)? Describe a typical split.
19. Do you issue advance invoices? How is the advance adjusted on later invoices?
20. Do you apply retention? What %, and when/how is it released and invoiced?
21. Does an invoice need internal approval before it is sent to the customer? Who approves, and above what amount?
22. How do you correct a wrong invoice today — edit, cancel and reissue, or credit note?
23. Describe your credit note process: triggers, approval, numbering, effect on the customer's balance.
24. Describe your debit note process and when you use it (penalties, extra charges, underbilling).
25. What must legally appear on a valid invoice in Kuwait (company registrations, Arabic text, stamp, signatures)?

### 17.4 Budget Allocation

26. Do budgets exist today — per project, per department, annual? Describe how they are set.
27. Who proposes a project budget, who approves it, and at what point in the job lifecycle?
28. Is a project budget one figure or broken into categories (equipment, procurement, labour, transport)?
29. How often are budgets reviewed against actuals?
30. Who can approve a budget increase, and are there value bands (e.g., Finance Manager up to X, GM above)?
31. When a purchase would exceed budget, should the system block it, allow it with an override approval, or just warn?
32. Should money committed on issued POs (but not yet delivered/invoiced) count against budget?

### 17.5 Procurement Integration

33. Before Finance approves a purchase request, what do you actually check today (budget, margin vs. the customer quotation, cash availability, vendor terms)?
34. What are the approval value bands for purchases, and who approves at each band?
35. For purchases tied to a customer job, must the customer quotation be approved (or advance received) before we commit spend to a vendor?
36. Describe the emergency purchase process: who can authorise, up to what amount, how is it documented afterwards, how is it paid?
37. Do you pay vendor advances/down-payments against POs? How are they settled?
38. What information must we hold about a vendor before we can pay them (bank details, registrations)? Who approves new vendors?

### 17.6 Vendor Invoices & Payments

39. When a vendor invoice arrives, what do you check it against (PO, delivery/GRN, contract)? What happens when quantities or prices don't match?
40. Is there a tolerance for small differences (e.g., accept up to __%)?
41. Who approves a vendor invoice for payment, and who approves the actual payment release?
42. Do you run payments on a schedule (e.g., weekly) or pay per due date?
43. Do you make partial payments to vendors? Under what circumstances?
44. What payment methods do you use for vendors, and do you issue payment vouchers / remittance advices?
45. How do you handle vendor credit notes and refunds?

### 17.7 Accounting Rules

46. Which accounting system holds your General Ledger today? Should the ERP post entries automatically to it, export files, or maintain its own GL?
47. Please provide your Chart of Accounts (or the relevant section for revenue, receivables, payables, VAT, assets, expenses).
48. What cost centres and profit centres do you use or want (departments, projects, business lines)?
49. Do you post manual journal entries? Who prepares and who approves them?
50. Is revenue recognised when the invoice is issued, or spread over the rental/contract period?
51. Describe your month-end checklist and how long closing takes today. What would you want the ERP to automate or enforce?
52. Describe year-end: fiscal year dates, audit adjustments, who is involved.
53. How is depreciation calculated and posted today (method, frequency)? How are asset disposals handled?

### 17.8 Tax Rules

54. What taxes currently apply to our sales and purchases (VAT? None? Withholding on foreign vendors)? At what rates?
55. Are any of our services or customers tax-exempt or zero-rated?
56. If tax rates change, how should documents already issued or in progress be treated?
57. What tax reports/returns must be produced, and how often?

### 17.9 Customer Payments & Credit

58. What are your standard customer payment terms? Do they vary by customer? Who sets them?
59. Do customers have credit limits? Who approves a limit or an increase?
60. Should the system warn or block when a new job would take a customer over their limit? Who can override?
61. Do you require advance payment before dispatch for any customers? Which ones and how much?
62. Do you accept partial payments? How do you decide which invoices a lump-sum payment settles?
63. Do you issue a receipt for every payment received? (Please share the format.)
64. How do you handle cheques — do you record post-dated cheques, and what happens when a cheque bounces?
65. Describe your payment reminder/dunning process: when do you chase, who chases (Finance or Sales), and what escalation steps exist?
66. Do you charge late payment penalties or interest? Who can waive them?
67. When do you classify a debt as doubtful or bad? Who approves provisions and write-offs?
68. How do you handle customer refunds and credits-on-account?

### 17.10 Multi-Currency

69. Do you ever quote, invoice, or receive payment in a currency other than KWD?
70. Do you ever pay vendors in foreign currency? Which currencies?
71. If yes to either: where do exchange rates come from, and which date's rate applies?

### 17.11 User Roles & Permissions

72. List the people/positions in the Finance team and what each is allowed to do (create invoices, approve payments, post journals, close periods).
73. Which of these should be separate ERP roles: Finance Manager, Accountant, Accounts Payable, Accounts Receivable? Any others (Cashier, Credit Controller)?
74. Which actions must never be done by the same person (segregation of duties) — e.g., the person who creates a payment must not approve it?
75. When an approver is on leave, who deputises? Should the system support formal delegation?
76. Should Sales/Operations be able to *see* invoice and payment status for their jobs (read-only)?

### 17.12 Compliance & Audit

77. What regulatory or statutory requirements apply to our financial records in Kuwait?
78. What do external auditors ask for each year? What reports/trails would make audits easier?
79. Do you need a full audit trail (who created/edited/approved every document, with timestamps)? Any fields that must be immutable once posted?
80. Are there document archiving/retention rules we must build in?

### 17.13 Exception Handling

81. Reviewing the Exception Matrix (Section 14): for each row marked "Finance must define", please state the rule you follow today or want. In particular:
   - duplicate/incorrect invoices (rows 5–6)
   - customer and vendor disputes (8–9)
   - project cancellation and on-hold (10–11)
   - advance adjustment and retention release (27–28)
   - bounced cheques (34)
82. Are there exceptions we have missed that happen in real life? Please describe any recurring "messy situations" Finance deals with.

### 17.14 ERP Automation Opportunities

83. Which finance tasks take the most manual time each week/month? (These are our best automation targets.)
84. Would you want the system to auto-generate: recurring lease invoices per period? monthly rental invoices? payment reminders? overdue status changes? depreciation entries?
85. Which notifications should Finance receive automatically (quotation awaiting approval, budget breach, invoice overdue, lease expiring, PO price variance)? By what channel — in-app, email, both?
86. Which reports would you want automatically emailed on a schedule, and to whom?
87. If you could change one thing about how Finance works with the other departments today, what would it be?

---

## Next Steps

1. **Finance review** — Finance team reads Sections 2–4 to understand the current ERP, flags anything that misdescribes reality.
2. **Workshop** — walkthrough session per workflow (Sections 3, 5–9) with the finance employee; capture answers live.
3. **Questionnaire completion** — Section 17 answered in writing, with sample documents attached.
4. **Critical path answers** — Section 16 questions answered first to unblock data-model design.
5. **Consolidation** — development team updates this document with answers; assumptions in Section 15 confirmed or corrected.
6. **Sign-off** — Finance Manager and project sponsor sign off; the document becomes the Finance module implementation blueprint.

---

*End of document.*
