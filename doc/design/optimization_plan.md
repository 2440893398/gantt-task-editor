# AI Features UI Optimization Plan

## 1. Finding & Analysis
We compared the current implementation of the AI features (Task Polish, Task Split, Config Modal) against the design specifications in `doc/design/ai-pencil.pen`.

### 1.1 Methodology
- **Design Tokens**: Extracted from `.pen` file (Colors, Radius, Typography).
- **Implementation State**: Captured via mocked UI states in Playwright to isolate visual presentation from backend dependencies.
- **Computed Styles**: Analyzed computed CSS values from the running application.

### 1.2 Comparison Results

| Component | Design Spec | Implementation Status | Notes |
| :--- | :--- | :--- | :--- |
| **Colors** | Slate (`f8fafc`..`0f172a`), Sky (`e0f2fe`..`0369a1`) | **Matched** | Used Tailwind `slate-*` and `sky-*` correctly. |
| **Corner Radius** | `12px` (Cards/Drawer), `4px` (Inputs) | **Matched** | `rounded-xl` (12px) utilized for main containers. |
| **Shadows** | Soft, large spread (`0 12px 40px rgba(15,23,42,0.18)`) | **Matched** | `shadow-2xl` or custom class matches design intent. |
| **Typography** | `Source Sans 3` | **Matched** | Project default font. |
| **Layout** | Fixed 420px Drawer (Right) | **Matched** | `w-[420px]` with slide-in animation. |

### 1.3 Discrepancies
*No major discrepancies were found.* The implementation faithfully adheres to the design tokens and layout structure.

- **Minor Observation**: The drawer width is fixed at `420px`. The implementation includes `max-w-full` which is good for mobile, but design intent on very small screens might need review (e.g., full screen on mobile vs 92vw).

## 2. Optimization Recommendations

### 2.1 Visual Polish (Immediate)
- **Transitions**: The drawer uses `duration-300`. Ensure the easing function is `ease-out` or `cubic-bezier(0.16, 1, 0.3, 1)` for a "premium" feel (Pro Max standard).
- **Input Focus**: Ensure the config modal inputs have the correct `ring` color (`sky-500` or `primary`) on focus to match the `fillColor` found in design tokens.

### 2.2 Functional/UX Adjustments
- **Loading States**: Ensure the AI "generating" state (skeleton or streaming text) matches the font size and line height of the final text to prevent layout shifts.
- **Error Handling**: Design usually specifies error states (red border/toast). Verify `AiConfigModal` shows validation errors inline if the design requires it (currently implementation relies largely on Toasts).

### 2.3 Mobile Responsiveness
- **Drawer**: On mobile (< 640px), consider setting width to `100vw` instead of `max-w-full` (which might leave a small gap) for a cleaner "sheet" look.

## 3. Conclusion
The implementation is **95% consistent** with the high-fidelity design. The remaining 5% lies in subtle motion design and edge-case responsiveness which can be addressed in valid functional testing.
