# Odoo ERP Context Map

This map separates the major business contexts represented by Odoo 19 Community. An addon is an implementation unit, not automatically a business boundary: connector addons integrate contexts, while shared technical records do not transfer ownership of every concept that references them.

Detailed glossaries are created lazily under `docs/contexts/<context>/CONTEXT.md` when a custom feature resolves context-specific language.

## Contexts

### Foundation, Identity & Organization

**Responsibility:** Establish the organizations, people, identities, permissions, shared classifications, currencies, units, communication primitives, and configuration on which the other contexts rely.

**Boundary:** Owns the identity and organizational meaning of companies, users, contacts, groups, privileges, currencies, and units. It does not own the commercial, financial, employment, or logistical roles that another context assigns to them.

**Addon anchors:** `base`, `base_setup`, `contacts`, `mail`, `calendar`, `resource`, `product`, `uom`, `portal`.

**Business concepts:** Company, Contact, User, Access Role, Currency, Unit of Measure, Resource, Activity, Message.

**Produces:** Trusted identities, organization boundaries, shared reference data, and communication capabilities.

**Consumes:** Configuration and role requirements defined by every other context.

### Customer Relationship Management

**Responsibility:** Track prospective demand from initial lead through qualified opportunity and loss or conversion.

**Boundary:** Owns leads, opportunities, sales teams, pipeline stages, forecasts, and loss reasons. It does not own quotations, confirmed orders, deliveries, or invoices.

**Addon anchors:** `crm`, `sales_team`, `crm_sms`, `crm_livechat`, `crm_iap_enrich`.

**Business concepts:** Lead, Opportunity, Pipeline Stage, Sales Team, Salesperson, Expected Revenue, Lost Reason.

**Produces:** Qualified opportunities and customer intent for Sales; campaign attribution for Marketing.

**Consumes:** Contacts and activities from Foundation; campaign sources from Marketing.

### Sales

**Responsibility:** Form commercial offers, agree customer demand, and manage the commercial lifecycle of customer orders.

**Boundary:** Owns quotations, sales orders, order lines, pricelists, commercial terms, and order confirmation. It does not own physical fulfillment, accounting entries, or payment settlement.

**Addon anchors:** `sale`, `sale_management`, `sales_team`, `sale_pdf_quote_builder`.

**Business concepts:** Quotation, Sales Order, Order Line, Pricelist, Commercial Term, Salesperson, Customer Commitment.

**Produces:** Confirmed demand for Inventory, Services, Manufacturing, and Accounting.

**Consumes:** Opportunities from CRM; products and contacts from Foundation; availability and delivery promises from Inventory.

### Procurement

**Responsibility:** Source goods and services from suppliers and manage purchase commitments.

**Boundary:** Owns requests for quotation, purchase orders, supplier terms, and purchase order lines. It does not own physical receipts, inventory valuation, or supplier accounting entries.

**Addon anchors:** `purchase`, `purchase_requisition`, `purchase_product_matrix`.

**Business concepts:** Request for Quotation, Purchase Order, Supplier, Purchase Order Line, Supplier Lead Time, Purchase Agreement.

**Produces:** Supply commitments and expected receipts for Inventory; billable purchase evidence for Accounting.

**Consumes:** Replenishment demand from Inventory and Manufacturing; products and supplier contacts from Foundation.

### Inventory & Logistics

**Responsibility:** Control physical quantities, locations, reservations, movements, receipts, deliveries, replenishment, lots, serials, and packages.

**Boundary:** Owns stock state and physical fulfillment. It does not own the commercial agreement that requested a movement or the journal entries representing its value.

**Addon anchors:** `stock`, `delivery`, `barcodes`, `barcodes_gs1_nomenclature`, `stock_picking_batch`.

**Business concepts:** Warehouse, Location, Stock Move, Transfer, Receipt, Delivery, Reservation, Reordering Rule, Lot, Serial Number, Package.

**Produces:** Fulfillment status for Sales and Commerce; receipt status for Procurement; material availability for Manufacturing; valuation events for Accounting.

**Consumes:** Customer demand from Sales and Commerce; supply commitments from Procurement; material requests and output from Manufacturing.

### Accounting

**Responsibility:** Record, classify, post, reconcile, and report the financial consequences of business activity.

**Boundary:** Owns journals, journal entries, invoices, bills, taxes, payments, reconciliation, analytic accounting, and financial reports. It does not own the operational event that provides the business evidence.

**Addon anchors:** `account`, `account_payment`, `analytic`, `account_edi`, `account_edi_ubl_cii`.

**Business concepts:** Journal, Journal Entry, Invoice, Vendor Bill, Tax, Payment, Reconciliation, Account, Analytic Account, Fiscal Position.

**Produces:** Financial position, settlement status, tax evidence, and management reporting.

**Consumes:** Commercial commitments from Sales and Procurement; valuation events from Inventory and Manufacturing; expenses and timesheets from People Operations and Services.

### Manufacturing

**Responsibility:** Plan and execute the transformation of components into finished products.

**Boundary:** Owns bills of materials, manufacturing orders, work orders, work centers, consumption, production, and unbuild operations. It relies on Inventory for physical stock state and Accounting for valuation.

**Addon anchors:** `mrp`, `mrp_account`, `mrp_workorder`, `mrp_subcontracting`.

**Business concepts:** Bill of Materials, Manufacturing Order, Work Order, Work Center, Component, Finished Product, By-product, Consumption, Production Plan.

**Produces:** Component demand, finished stock, work-center load, and manufacturing valuation events.

**Consumes:** Product definitions from Foundation; stock availability and movements from Inventory; demand from Sales and replenishment planning.

### Services & Projects

**Responsibility:** Plan and deliver project- or task-based services, milestones, time, collaboration, and customer-facing progress.

**Boundary:** Owns projects, tasks, milestones, assignments, service delivery progress, and project updates. It does not own employee identity, commercial orders, or accounting entries.

**Addon anchors:** `project`, `project_todo`, `hr_timesheet`, `sale_project`, `rating`.

**Business concepts:** Project, Task, Milestone, Assignee, Timesheet, Service Delivery, Project Update, Rating.

**Produces:** Delivery and time evidence for Sales, People Operations, and Accounting.

**Consumes:** Service commitments from Sales; people and availability from People Operations; contacts and activities from Foundation.

### People Operations

**Responsibility:** Manage the employee lifecycle, organization structure, attendance, leave, recruitment, skills, and reimbursable expenses.

**Boundary:** Owns employees, departments, jobs, applicants, attendance, leave, skills, and expenses. It does not own user authentication, project delivery, or general-ledger entries.

**Addon anchors:** `hr`, `hr_recruitment`, `hr_attendance`, `hr_holidays`, `hr_skills`, `hr_expense`.

**Business concepts:** Employee, Department, Job Position, Applicant, Attendance, Leave, Skill, Expense, Work Location.

**Produces:** Workforce availability, expense evidence, skills, and organizational assignments.

**Consumes:** Identities and contacts from Foundation; project and time demand from Services; accounting outcomes for expenses.

### Commerce

**Responsibility:** Present products and content to buyers and conduct online or in-person checkout experiences.

**Boundary:** Owns storefront presentation, carts, checkout sessions, point-of-sale sessions, orders at the channel edge, and customer-facing payment selection. It delegates the durable commercial order, stock, payment, and accounting consequences to their owning contexts.

**Addon anchors:** `website`, `website_sale`, `point_of_sale`, `pos_restaurant`, `payment`, `website_payment`.

**Business concepts:** Storefront, Cart, Checkout, Point-of-Sale Session, POS Order, Payment Method, Website Visitor, Product Page.

**Produces:** Customer orders for Sales, demand for Inventory, and payment/accounting evidence.

**Consumes:** Products and contacts from Foundation; pricing and order rules from Sales; availability from Inventory; settlement capabilities from Accounting.

### Marketing & Engagement

**Responsibility:** Segment audiences, attribute acquisition, run outbound communications, conduct surveys, and manage engagement programs.

**Boundary:** Owns campaigns, sources, media, mailing audiences, communications, surveys, and responses. It does not own CRM opportunity state, commercial orders, or customer accounting.

**Addon anchors:** `utm`, `mass_mailing`, `mass_mailing_sms`, `survey`, `event`, `website_event`, `im_livechat`.

**Business concepts:** Campaign, Source, Medium, Mailing List, Mailing, Recipient, Survey, Response, Event, Registration.

**Produces:** Engagement, attribution, responses, registrations, and leads for CRM and Commerce.

**Consumes:** Contacts and communication infrastructure from Foundation; conversion outcomes from CRM and Commerce.

### Asset Operations

**Responsibility:** Manage operational assets, vehicles, maintenance demand, repairs, and service history.

**Boundary:** Owns equipment, vehicles, maintenance requests, repair orders, operational condition, and service history. It does not own parts inventory or financial valuation.

**Addon anchors:** `maintenance`, `fleet`, `repair`, `hr_maintenance`, `stock` integrations.

**Business concepts:** Equipment, Vehicle, Maintenance Request, Maintenance Team, Repair Order, Service, Odometer, Operational Condition.

**Produces:** Maintenance work, parts demand, asset availability, and cost evidence.

**Consumes:** Employees from People Operations; parts and movements from Inventory; expense and valuation capabilities from Accounting.

### Hosting Operations

**Responsibility:** Provision and operate isolated Odoo instances for prospects and customers outside the primary agentic-erp deployment — sales trials today, paid hosting later.

**Boundary:** Owns Trial Org lifecycle (issuance, seats, suspend/wake, extension, auto-destroy) and the AWS infrastructure it runs on. It does not own the commercial decision to issue a trial (that's CRM's Opportunity) or billing for paid hosting (future Accounting/Sales concern).

**Addon anchors:** `hosting` (installed on every Trial Org/customer instance; namespace `hosting`; shows that org's own registration info — name, domain, seats, expiry); `hosting_admin` (installed only on the factory1 Platform instance; namespace `hosting.admin`; owns the Trial Org model across all orgs, AWS/OpenTofu integration, suspend/wake control, cost dashboard). `crm_methodology` gets a thin "Issue Trial" / "Extend" action on the Opportunity that calls into `hosting_admin`.

**Business concepts:** Trial Org, Seat, Active, Suspended, Wake, Auto-Destroy, Extension, Hosting Account, Org Registration.

**Produces:** A live, reachable demo/hosting environment for a given Opportunity's prospect domain.

**Consumes:** Opportunity and prospect-domain data from CRM; sales-methodology qualification state for gating Extension.

Detailed glossary: [`docs/contexts/hosting/CONTEXT.md`](docs/contexts/hosting/CONTEXT.md)

## Relationships

- **CRM → Hosting Operations:** a qualified Opportunity can request a Trial Org; Hosting Operations owns the deployed instance's lifecycle and reports its state back onto the Opportunity.
- **Foundation → all contexts:** supplies identity, company, contact, product-reference, currency, unit, activity, and communication capabilities; consuming contexts assign their own business roles.
- **CRM → Sales:** a qualified opportunity can become a quotation; Sales owns the resulting commercial commitment.
- **Sales → Inventory:** confirmed product demand requests reservation and delivery; Inventory owns fulfillment state.
- **Sales → Services & Projects:** confirmed service demand can create projects, tasks, or milestones; Services owns delivery progress.
- **Sales → Accounting:** invoiceable commercial evidence requests customer invoicing; Accounting owns posting and settlement.
- **Procurement → Inventory:** purchase commitments create expected receipts; Inventory owns receipt and stock state.
- **Procurement → Accounting:** supplier evidence requests vendor bills; Accounting owns posting and payment.
- **Inventory ↔ Manufacturing:** Manufacturing requests and consumes components, while Inventory records components and finished goods as physical movements.
- **Inventory → Accounting:** stock valuation events are translated into financial entries without transferring ownership of physical stock.
- **Manufacturing → Accounting:** production valuation and variance evidence become financial consequences.
- **Commerce → Sales, Inventory, and Accounting:** channel interactions become durable orders, stock demand, and payment/accounting evidence in their owning contexts.
- **People Operations → Services & Projects:** employees, skills, availability, and expenses support service delivery; projects own tasks and milestones.
- **Services & Projects → Accounting:** timesheets, milestones, and delivery evidence can drive invoicing and analytic accounting.
- **Marketing & Engagement → CRM and Commerce:** attributed engagement can produce leads, registrations, and buying sessions; downstream contexts own conversion.
- **Asset Operations → Inventory and Accounting:** maintenance and repair consume parts and produce cost evidence while Asset Operations retains service history.

## Integration Addons

Connector addons implement the relationships above. Their presence does not create a new bounded context:

- `sale_stock`: Sales ↔ Inventory
- `purchase_stock`: Procurement ↔ Inventory
- `stock_account`: Inventory ↔ Accounting
- `sale_project`: Sales ↔ Services & Projects
- `website_sale`: Commerce ↔ Sales
- `website_sale_stock`: Commerce ↔ Inventory
- `sale_mrp`: Sales ↔ Manufacturing
- `purchase_mrp`: Procurement ↔ Manufacturing
- `mrp_account`: Manufacturing ↔ Accounting
- `hr_expense`: People Operations ↔ Accounting
