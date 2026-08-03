---
name: Digital Legacy System
colors:
  surface: '#f7f9fb'
  surface-dim: '#d8dadc'
  surface-bright: '#f7f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f6'
  surface-container: '#eceef0'
  surface-container-high: '#e6e8ea'
  surface-container-highest: '#e0e3e5'
  on-surface: '#191c1e'
  on-surface-variant: '#45464d'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eff1f3'
  outline: '#76777d'
  outline-variant: '#c6c6cd'
  surface-tint: '#565e74'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#131b2e'
  on-primary-container: '#7c839b'
  inverse-primary: '#bec6e0'
  secondary: '#006c49'
  on-secondary: '#ffffff'
  secondary-container: '#6cf8bb'
  on-secondary-container: '#00714d'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#2a1700'
  on-tertiary-container: '#b87500'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae2fd'
  primary-fixed-dim: '#bec6e0'
  on-primary-fixed: '#131b2e'
  on-primary-fixed-variant: '#3f465c'
  secondary-fixed: '#6ffbbe'
  secondary-fixed-dim: '#4edea3'
  on-secondary-fixed: '#002113'
  on-secondary-fixed-variant: '#005236'
  tertiary-fixed: '#ffddb8'
  tertiary-fixed-dim: '#ffb95f'
  on-tertiary-fixed: '#2a1700'
  on-tertiary-fixed-variant: '#653e00'
  background: '#f7f9fb'
  on-background: '#191c1e'
  surface-variant: '#e0e3e5'
  status-setup: '#64748B'
  status-armed: '#10B981'
  status-recovery: '#F59E0B'
  status-alert: '#EA580C'
  status-critical: '#DC2626'
  border-subtle: '#E2E8F0'
  text-primary: '#0F172A'
  text-secondary: '#475569'
typography:
  display-countdown:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-mono:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
  legal-text:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 26px
    letterSpacing: 0.01em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 8px
  container-max: 1024px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 40px
---

## Brand & Style

The design system is anchored in the concepts of **Solemnity, Security, and Absolute Reliability**. It serves a high-stakes purpose—the management of digital inheritance—and must therefore project a tone of mechanical certainty and legal weight. 

We employ a **Minimalist** design style that prioritizes content clarity and functional friction over aesthetic decoration. The interface is "cold" and utilitarian, reflecting the gravity of its task. By using ample whitespace, a disciplined color palette, and high-quality typography, the system ensures that users are never distracted from critical legal information or high-consequence actions.

**Key Principles:**
- **Intentional Friction:** Unlike traditional consumer apps, this system introduces deliberate pauses (e.g., mandatory reading times, manual confirmation typing) to ensure every action is legally defensible and intentional.
- **State-Dependent Interface:** The UI transforms based on the system lifecycle (Setup, Armed, Pending, Released), shifting from a private management dashboard to a public memorial or data portal.
- **Utilitarian Clarity:** Information density is high for audit logs and legal documents, requiring a layout that remains readable under stress.

## Colors

The color palette is designed for maximum clarity and emotional stability.
- **Primary (Midnight Blue):** Used for headers, primary navigation, and core branding to evoke trust and institutional authority.
- **Secondary (Emerald):** Represents the "Armed" or "Safe" state. It indicates successful check-ins and active system health.
- **Tertiary (Amber):** Used specifically for countdowns and warnings (e.g., Password Recovery phase) to signal the need for attention without inducing panic.
- **Neutral (Slate/Light Grey):** Provides a clean, paper-like background that emphasizes the text-heavy nature of the system.

**Semantic States:**
- **Critical Red:** Reserved exclusively for the final `DEATH_CONFIRMING` and `RELEASE_PENDING` phases where the 24-hour countdown is active.
- **Setup Grey:** Used for incomplete configurations to indicate a dormant or non-functional state.

## Typography

The system utilizes **Inter** for its neutral, highly legible characteristics across both Simplified Chinese and Latin characters. For technical and security data (Hashes, Audit Logs, File Paths), **JetBrains Mono** provides the necessary precision and visual distinction.

**Hierarchy Guidance:**
- **Display Countdown:** High-impact, tabular numbers to ensure the time remaining is unmistakable.
- **Legal Text:** Specific line-height (1.7+) and slightly larger font size for the "Informed Consent" and "Will" sections to reduce eye strain during mandatory 30-second reading periods.
- **Monospace Labels:** Used for system-generated logs to indicate that the information is an immutable part of the audit chain.

## Layout & Spacing

The layout follows a **Fixed Grid** model for desktop to ensure long-form legal documents remain at an optimal reading width (max 1024px). On mobile, the system transitions to a fluid, single-column layout with reinforced margins to prevent accidental taps.

**Grid & Rhythm:**
- **8px Base Unit:** All padding, margins, and component heights are multiples of 8px.
- **Reading Comfort:** Content blocks (like the "Will" or "Informed Consent") are centered with generous vertical spacing (64px+) to create a focused, distraction-free environment.
- **Friction Layouts:** Actions like "Confirm Death" are placed at the very bottom of long-form scrolling areas to ensure the user has processed the preceding information.

## Elevation & Depth

To maintain a solemn and professional atmosphere, this design system avoids complex shadows and decorative blurs. It relies on **Low-Contrast Outlines** and **Tonal Layers** to establish hierarchy.

- **Surface Tiers:** The main background is the lightest neutral. Cards and containers use a white background with a subtle `1px` border (`#E2E8F0`).
- **Interactive States:** No "floating" or neomorphic effects. Interaction is signaled through color shifts (e.g., a button becoming more saturated) rather than elevation changes.
- **Modals:** Used for critical confirmations. These utilize a high-opacity dark overlay (`#0F172A` at 60%) to completely "dim" the background, forcing the user to focus on the high-stakes choice.

## Shapes

The shape language is **Soft (0.25rem)**. This slight rounding takes the "edge" off the utilitarian design without making the system feel playful or informal. 

- **Primary Buttons & Inputs:** Use the standard `rounded` (4px) corner.
- **Status Badges:** May use `rounded-lg` (8px) to distinguish them from interactive buttons.
- **Strictness:** Large containers and the main viewport retain sharp or very slightly rounded edges to maintain the architectural, document-like feel of the legacy system.

## Components

**Buttons:**
- **Primary:** Solid Midnight Blue with white text. High contrast, authoritative.
- **Critical Action:** Solid Orange or Red. Requires a "hold to confirm" or "type to confirm" pattern rather than a simple click.
- **Disabled:** Solid light grey. Specifically used on the Consent Form to enforce the 30-second dwell time.

**Inputs & Forms:**
- **Strict Validation:** Inputs for "Death Confirmation" phrases must disable all clipboard events (copy/paste). 
- **Checkboxes:** In the legal registration flow, these must be unchecked by default and require individual manual interaction.
- **Monospace Fields:** Used for displaying SHA-256 hashes to ensure every character is distinct.

**Audit Timeline:**
- A vertical list using `label-mono` typography. Each entry is timestamped and visually connected by a subtle vertical line, representing the "Immutable Chain of Custody."

**The Countdown Clock:**
- Large-scale display typography. It should include milliseconds for the final hour to emphasize the mechanical, irreversible nature of the "Release" state.

**Status Badges:**
- Small, uppercase labels with a background tint corresponding to the system state (e.g., a light emerald background with dark emerald text for the "ARMED" state).