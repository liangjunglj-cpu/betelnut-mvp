# PRD — Map-First Conservation Copilot (MVP)

**Use case anchor:** Temasek Shophouse (28 Orchard Road)  
**Primary audience:** Temasek Shophouse team, Surbana Jurong (SJ) project teams, conservation consultants, preservation contractors  
**Status:** Draft (MVP)  
**Owner:** _[Your Name]_  
**Last updated:** 2026-02-26  

---

## 0. Document Control

- **Product name:** Map-First Conservation Copilot
- **MVP objective:** Site → dossier → phase checklist → evidence-based guidance → one-page export
- **Positioning:** Decision-support + retrieval + templates (not an approver, not a replacement for professionals)

---

## 1. Background & Problem Statement

### 1.1 Context

Conservation work in Singapore is shaped by:

- **Site constraints** (tight access, adjacent sensitive structures, monitoring needs)
- **Regulatory expectations** (URA conservation principles and technical guidance)
- **Technical restoration decisions** (retain/repair/replicate, material compatibility, reversibility)
- **Operational programme** (publicness, accessibility, flexibility, long-term stewardship)

The Temasek Shophouse restoration story demonstrates typical delivery constraints such as adjacency sensitivities, access/haulage planning, and monitoring for movement/settlement.

### 1.2 Problem

Information needed to make good decisions is fragmented across:

- map portals and datasets (context/boundaries),
- guideline pages/PDFs,
- internal templates and checklists,
- precedent narratives and post-rationalizations.

This leads to:

- time lost searching,
- inconsistent documentation quality,
- higher risk of rework (missing evidence, late design reversals, avoidable site issues),
- lower trust and adoption of “AI” outputs that are not source-grounded.

---

## 2. Product Vision

A **map-first web app** where selecting a conserved building instantly provides:

1) a **Building Dossier** (context + official references),  
2) **Phase-based checklists** (survey → design → construction → handover), and  
3) a **citation-grounded assistant** that turns guidelines into **actionable outputs** and exportable documentation.

---

## 3. Goals & Non-Goals

### 3.1 Goals (MVP)

1. **Time-to-dossier < 30 seconds** from address search to complete dossier panel.
2. **Guidelines become tasks:** generate practical, editable phase checklists.
3. **Evidence-based assistant:** responses cite official sources where applicable and show uncertainty where not.
4. **One-page export:** produce a printable/shareable **Site Conservation Action Sheet**.

### 3.2 Non-Goals (MVP)

- Submitting applications to URA or automating approvals.
- Producing legally binding conservation advice.
- Replacing conservation consultants, architects, or URA review.
- Scraping or relying on unstable/non-public endpoints.

---

## 4. Users & Personas

### P1 — Project Architect / Design Manager (SJ)

- Needs rapid clarity on constraints + expected evidence.
- Needs defensible narratives for stakeholders and design decisions.

### P2 — Site / Construction Manager (Contractor)

- Needs buildable checklists: monitoring, logistics windows, protection of fabric, sequencing.
- Wants printable action sheets that survive on-site realities.

### P3 — Conservation Specialist (Consultant)

- Wants traceability, conservation logic, and cited references.
- Needs quick collation of known requirements and “what to justify.”

### P4 — Client / Operator (Temasek Shophouse team)

- Wants stewardship-ready outputs: maintenance structures, intent statements, and operational considerations.

---

## 5. Primary Use Case (Temasek Shophouse Demo Flow)

**User story:** “I’m meeting on Temasek Shophouse. I want to see conservation context fast and generate a logistics + evidence checklist.”

**Flow (MVP):**

1. Search “28 Orchard Road” → zoom to site.
2. Click conserved polygon → open **Building Dossier**.
3. Review/edit **Constraints Card** (adjacency, access, monitoring, working hours).
4. Generate **Construction Planning Checklist**.
5. Ask assistant: “We’re reinstating daylight by removing later additions—what evidence should we prepare?”  
   → structured answer (recommendation/risks/evidence/references).
6. Export **PDF Site Conservation Action Sheet**.

---

## 6. MVP Scope (Features)

### 6.1 Map & Search

- Address/POI search (Singapore-wide)
- Clickable conserved building polygons
- Layer toggles (minimum two)
- Basemap + geocoding integration

### 6.2 Building Dossier Panel

For the selected site:

- Address + basic identifiers
- Conservation context links (official guideline landing pages; curated PDFs)
- Editable “Project Notes”
- Export actions

### 6.3 Constraints Card (Template + Editable)

Structured, editable fields:

- Adjacent structures sensitivity (Yes/No + notes)
- Access limitations (Yes/No + notes)
- Monitoring needs (crack/settlement/vibration) (checkboxes)
- Working hours / logistics constraints (e.g., night deliveries)
- Protected elements list (free text)
- Open issues / assumptions (free text)

### 6.4 Checklist Generator (Phase-based)

Generate and edit checklists for:

- **Due diligence / survey**
- **Design development**
- **Construction planning**
- **Handover / stewardship**

Checklist item format:

- Action item
- Why it matters (1 line)
- Evidence to attach (photos/drawings/tests)
- Reference links (when applicable)

### 6.5 Chat Assistant (Citation-Grounded)

Capabilities:

- Q&A grounded in curated sources (guidelines, selected project templates)
- Structured “Generate” commands:
  - checklists, evidence packs, rationale paragraphs, method statement scaffolds
- Response format:
  - **Recommendation → Risks → Evidence needed → References**

Guardrails:

- Prominent disclaimer: “Decision support, not an approval.”
- Do not impersonate a real person; present as “Conservation Review Mode.”

### 6.6 Export: “Site Conservation Action Sheet” (PDF)

One-page export containing:

- Site header (address/date/team)
- Constraints card snapshot
- Selected checklist items (e.g., top 10)
- Quick links to key references
- Optional short “project intent” paragraph

---

## 7. Functional Requirements (FR)

### Map & Search

- **FR-1:** User can search address/POI and zoom to result.
- **FR-2:** User can toggle conserved building overlays.
- **FR-3:** Clicking a polygon selects it and opens dossier.

### Dossier & Notes

- **FR-4:** Dossier shows curated official reference links relevant to conservation.
- **FR-5:** User can edit constraints fields and save a draft (local storage or account-based).

### Checklists

- **FR-6:** Generate checklist by phase; items are editable.
- **FR-7:** Checklist items support references and evidence fields.

### Assistant

- **FR-8:** Assistant answers using only curated sources; cites references when applicable.
- **FR-9:** Assistant can generate structured outputs (checklists/evidence packs/rationales).
- **FR-10:** Assistant signals uncertainty when sources do not cover a question.

### Export

- **FR-11:** Export selected dossier into a one-page PDF.

---

## 8. Non-Functional Requirements (NFR)

- **NFR-1 Performance:** initial map load < 3s on typical office Wi-Fi; dossier open < 1s after polygon select (excluding API latency).
- **NFR-2 Reliability:** graceful degradation if an external API is down (cached geometry + user message).
- **NFR-3 Security:** protect stored notes (access control; encryption at rest if server-side).
- **NFR-4 Auditability:** log references used in assistant answers; include in export.
- **NFR-5 Maintainability:** guideline links/templates editable via config or admin UI.

---

## 9. Data Sources & Integrations

### 9.1 Required (MVP)

- Conserved building geometry dataset (polygons)
- Singapore map + geocoding/search API
- Curated official guideline pages and PDFs (as reference set)

### 9.2 Optional (Phase 2)

- URA Data Service APIs for broader planning/property context (token-based access)
- Conservation area/context overlays
- Award/precedent overlay library

### 9.3 Notes

- Prefer official/open datasets and documented APIs.
- Avoid scraping non-public endpoints; design for change tolerance (cache + versioning).

---

## 10. UX Requirements (Visual MVP)

### Screen A — Map Workspace

- Left: map with layer toggle + search
- Right: collapsible panel with tabs:
  - **Dossier**
  - **Checklists**
  - **Chat**
  - **Export**

### Screen B — Dossier (Selected Site)

- Header: address + tags
- Sections:
  - Conservation context (links)
  - Constraints card (editable)
  - Project notes (free text)

### Screen C — Checklist Builder

- Phase selector
- Generated checklist (editable)
- “Include in PDF” toggles per item

### Screen D — Chat

- Prompt box + quick prompts:
  - “Generate due diligence checklist”
  - “What evidence do I need for ___?”
- Output cards:
  - Recommendation / Risks / Evidence / References

---

## 11. Success Metrics (MVP)

- **Time-to-dossier:** median time from search → dossier open
- **Checklist usage:** % sessions generating at least one checklist
- **Export rate:** % sessions exporting PDF
- **Reference coverage:** % assistant answers that include at least one valid reference when applicable
- **User feedback:** “Would this reduce rework?” (qualitative score from SJ/Temasek team)

---

## 12. Risks & Mitigations

1. **Data incompleteness (constraints are project-specific)**
   - Mitigation: editable constraints card + note fields; allow team input.

2. **Trust/liability concerns with AI outputs**
   - Mitigation: citation-first, structured outputs, disclaimers, “unknown” handling, export includes references.

3. **API availability / rate limiting**
   - Mitigation: caching, backoff/retry, offline snapshot mode for conserved polygons.

4. **Guideline changes over time**
   - Mitigation: reference set versioning; show “last checked”; admin/config update.

---

## 13. Out of Scope (MVP; Future Directions)

- Automated condition assessment from photos/scans
- Live structural monitoring sensor integration
- Full submission package generation
- Multi-project dashboarding and portfolio analytics
- Contractor bidding/tender workflow integration

---

## 14. Appendix (Suggested MVP Deliverables for the Meeting)

### 14.1 Live Demo Checklist

- Map search (28 Orchard Road)
- Select polygon → dossier
- Generate “Construction Planning Checklist”
- Ask assistant a daylight reinstatement evidence question
- Export one-page PDF

### 14.2 Demo Content Pack (Seeded)

- 10–20 curated reference links (official guidance + your internal templates)
- 4 checklist templates (one per phase)
- 10 chat quick prompts tailored to shophouse + Art Deco conservation workflows
