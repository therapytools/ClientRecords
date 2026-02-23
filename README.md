# Progress Note Generator

> ## ⚠️ Important Disclaimer
> This project is a **proof of concept (POC)** for exploratory development only.
> It is **NOT HIPAA compliant**, **NOT security-audited**, and **NOT intended for production use**.
> Do not use this project to store, process, or transmit real PHI in live clinical workflows.

**GitHub repository description (copy/paste):**
`Proof-of-concept progress note tool for future development — NOT HIPAA compliant, NOT production-ready, and not for real PHI.`

A simple tool that converts **"in the moment"** notes written during a telehealth session into structured progress notes. These notes can be easily copied and pasted into an Electronic Health Record (EHR).  

All client data is stored **locally on your computer** to ensure security and privacy of records.

Any future HIPAA-oriented implementation would require substantial architectural, legal, and operational controls before production use.

## Specific HIPAA Concerns (Current POC)
- No formal HIPAA security risk analysis or documented remediation plan.
- No Business Associate Agreement (BAA) framework enforced across all potential vendors/services.
- Potential use of third-party AI endpoints may involve PHI transmission outside a HIPAA-ready environment.
- Browser/local device storage may be insufficient for enterprise-grade access controls, auditability, and key management.
- No verified production controls for role-based access, minimum necessary access, immutable audit logs, incident response, or breach notification workflows.

## Clinical Documentation Caution
- AI-generated note content is intended as **interpretation, assumption, and suggestion**, not authoritative factual record.
- Suggested notes **must be read carefully and edited by the clinician** to ensure they accurately reflect what actually occurred with the client.
- The clinician is responsible for final documentation accuracy, clinical appropriateness, and compliance with legal/ethical standards.

---

## Features
- Write quick notes during a session and generate polished progress notes.
- Copy-ready format for EHR systems.
- Local storage only — no cloud, no external servers.


