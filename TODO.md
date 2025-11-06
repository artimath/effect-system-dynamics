# TODO - effect-system-dynamics

## API Improvements for v0.2.0

### Current Pain Points
1. **Too much boilerplate** - Manual UUID generation for every Stock/Flow/Variable
2. **Unit conversion syntax verbose** - `[Stock] / { 1 units } * scalar * { 1 other_units }`
3. **Sharp edge: unit compatibility** - Can't do cross-unit flows (e.g., leads→contracts), must split into separate consumption/acquisition flows
4. **Not discoverable** - Unit mismatch errors require trial-and-error
5. **Equation DSL cryptic** - `{ 1 tick }` vs `[StockName]` syntax not immediately obvious

### Proposed Builder API
```typescript
const model = SystemDynamics.create()
  .stock('stars', 50)
  .stock('downloads', 100)
  .flow('star_growth', 'stars', s => s.stars * 0.15)
  .flow('download_rate', 'downloads', s => s.stars * 2.5)
  .simulate(24)
```

### Documentation Improvements
- Add "Sharp Edges" section to README
- Document unit compatibility constraints prominently
- Provide more equation DSL examples
- Add migration guide from constructor-based to builder API (if implemented)

## Validation Tests Needed
- [ ] Classic SIR epidemic model (verify against published results)
- [ ] World3 population dynamics (simple subset)
- [ ] Bass diffusion model (marketing)
