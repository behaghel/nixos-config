# Wireframe Conventions

SVG wireframes are the visual spec. They define precisely what the user sees — layout, components, text, colors, and states. Implementation must match element-by-element.

## Principles

1. **Wireframes are contracts, not sketches.** Coordinates, sizes, and colors in the SVG are the source of truth.
2. **One SVG per screen state.** Welcome, loading, populated, error, empty, success — each is a separate file.
3. **Hand-coded is preferred.** Hand-coded SVGs with HTML comments documenting intent are more maintainable and diffable than tool-exported SVGs.
4. **Wireframes live with their story.** Path: `spec/{domain}/stories/{story-name}/wireframes/{state}.svg`.

## SVG structure conventions

### Viewport

```xml
<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 393 852"
     width="393" height="852">
```

- Use device-resolution viewport (393x852 for standard mobile).
- All coordinates are in device-independent pixels.

### Comments

Every wireframe must document its intent:

```xml
<!-- SCREEN: My Cachets Tab (Home — left tab)
     STORY: returning-holder/manage-cachets
     STATE: populated (3 credentials, none revoked)
     DOMAIN: wallet/credentials -->
```

### Reusable symbols

Define shared components as SVG `<symbol>` elements:

```xml
<defs>
  <symbol id="brand-shield" viewBox="0 0 400 480">
    <!-- Shield path data -->
  </symbol>
  <symbol id="fab-plus" viewBox="0 0 56 56">
    <!-- FAB button -->
  </symbol>
</defs>
```

Reference with `<use>`:
```xml
<use href="#brand-shield" x="120" y="200" width="150" height="180"/>
```

### Color palette

Use the project's design tokens. Define them in the SVG or reference the project palette:

```xml
<!-- PALETTE:
  Emerald (brand):  #10B981
  Slate (text):     #1E293B
  Stone (secondary):#57534E
  Surface:          #FAFAF9
  Error/Revoked:    #DC2626
-->
```

### Layer naming

Organize elements by semantic purpose:

```xml
<!-- LAYER: status-bar -->
<g id="status-bar">...</g>

<!-- LAYER: header -->
<g id="header">...</g>

<!-- LAYER: content -->
<g id="content">...</g>

<!-- LAYER: navigation -->
<g id="bottom-nav">...</g>
```

## Naming conventions

| Pattern | Example | When to use |
|---------|---------|-------------|
| `{screen-state}.svg` | `welcome.svg`, `populated.svg` | Default — one state per file |
| `{screen}-{variant}.svg` | `detail-revoked.svg`, `detail-hardware.svg` | Scenario-specific variants |
| `{step-N}-{action}.svg` | `step-1-scan.svg`, `step-2-confirm.svg` | Multi-step flows |

## What a wireframe must specify

For each screen state, the wireframe must include:

1. **Layout** — Position and size of every element (x, y, width, height)
2. **Typography** — Text content, font size, weight, color
3. **Components** — Which UI component renders each element (shield, chip, button, card)
4. **Colors** — Background, foreground, accent colors for each element
5. **States** — Visual indicators (enabled/disabled, selected/unselected, expanded/collapsed)
6. **Navigation** — Which elements are tappable and where they lead

## What a wireframe does NOT specify

1. **Animation** — Transitions, durations, easing curves (document separately if needed)
2. **Exact font rendering** — Font metrics vary; match intent, not pixels
3. **Platform chrome** — Status bar, navigation bar handled by OS
4. **Data binding** — How data gets to the screen (that's the spec's job)

## Wireframe review checklist

When reviewing a wireframe against implementation (screenshot):

- [ ] **Layout order** — Elements appear in the same top-to-bottom, left-to-right order
- [ ] **Component types** — Correct UI components used (shield, chip, button match wireframe)
- [ ] **Text content** — Labels, titles, body text match (including vocabulary: "cachets" not "credentials")
- [ ] **Visual alignment** — Centering, edge alignment, spacing proportions
- [ ] **Colors and states** — Status colors, enabled/disabled states, accent colors
- [ ] **Interactive elements** — Tappable areas are tappable, navigation works
- [ ] **Missing elements** — Nothing in the wireframe is absent from the implementation
- [ ] **Extra elements** — Nothing in the implementation is absent from the wireframe

## Scenario-specific wireframes

Some wireframes exist only for specific scenarios (revoked, expired, empty). Name them with the scenario:

```
wireframes/
├── vault-populated.svg         ← default state
├── vault-empty.svg             ← empty state
├── vault-revoked.svg           ← scenario: credential revoked
└── detail-hardware.svg         ← scenario: hardware-backed indicator
```

Link scenario wireframes to BDD scenarios in the `.feature` file:

```gherkin
# Wireframe: wireframes/vault-revoked.svg
Scenario: Revoked credential appears in vault
  Given I have a revoked identity credential
  When I open My Cachets
  Then I see the credential with a "Revoked" status chip in red
```
