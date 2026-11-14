---
title: Core formulas
category: math
guide: guides/case-math.md
description: Profit, break-even, valuation, growth and unit economics.
---

## Q: Define gross margin, operating margin and net margin.
@tags formula, profitability
- **Gross margin** = (revenue − COGS) ÷ revenue
- **Operating (EBIT) margin** = operating income ÷ revenue
- **Net margin** = net income ÷ revenue

## Q: What is EBITDA, and why do people use it?
@tags formula, profitability
**EBITDA = operating income + depreciation + amortization.** A rough proxy for operating cash flow that ignores capital structure, taxes and non-cash charges, so it's easy to compare across companies.

## Q: What is contribution margin (per unit and as a ratio)?
@tags formula, profitability
- Per unit: **price − variable cost per unit**
- Ratio: **(price − variable cost) ÷ price**

It is what each unit contributes toward fixed costs and profit.

## Q: What is the break-even volume formula?
@tags formula, break-even
**Break-even units = fixed costs ÷ (price − variable cost per unit).**
Break-even revenue = fixed costs ÷ contribution margin ratio.

## Q: A product sells for $50 with $30 variable cost. Fixed costs are $400K. What is break-even volume?
@tags formula, break-even, practice
Contribution = $20 per unit. $400K ÷ $20 = **20,000 units**.

## Q: What is payback period?
@tags formula, investment
**Payback = upfront investment ÷ annual cash flow** (if flows are even). It ignores the time value of money and anything after payback.

## Q: How do you calculate ROI?
@tags formula, investment
**ROI = (gain − cost) ÷ cost.** Annualize it if comparing projects of different lengths.

## Q: What is NPV, and when do you accept a project?
@tags formula, investment
**NPV = Σ CFₜ ÷ (1 + r)ᵗ − initial investment.** Accept if NPV > 0 at the cost of capital r.

## Q: Value of a perpetuity, and of a growing perpetuity?
@tags formula, investment
- Perpetuity: **CF ÷ r**
- Growing perpetuity: **CF₁ ÷ (r − g)**, with g < r

Example: $10M a year at 10% = $100M.

## Q: What is IRR?
@tags formula, investment
The discount rate at which **NPV = 0**. Accept if IRR > the hurdle rate. PE funds often target ~20%+.

## Q: What is the CAGR formula?
@tags formula, growth
**CAGR = (end value ÷ start value)^(1 / years) − 1.**

## Q: What is the rule of 72?
@tags formula, growth, mental-math
**Years to double ≈ 72 ÷ growth rate (%).** E.g. 8% a year doubles in ~9 years.

## Q: Percent change vs. percentage points: what's the difference?
@tags formula
Margin from 10% to 12% is **+2 percentage points** but **+20% relative change**. Say which one you mean.

## Q: How do you calculate market share and relative market share?
@tags formula, market
- Market share = company sales ÷ total market sales
- Relative share = company share ÷ largest competitor's share

## Q: What is price elasticity of demand?
@tags formula, pricing
**Elasticity = % change in quantity ÷ % change in price.** If |elasticity| > 1, demand is elastic and a price cut raises revenue; if < 1, a price increase raises revenue.

## Q: How do you calculate customer lifetime value (simple version)?
@tags formula, unit-economics
**LTV ≈ (average revenue per period × margin) ÷ churn rate per period.** Average lifetime = 1 ÷ churn. Compare with CAC (rule of thumb: LTV ≥ 3× CAC).

## Q: What is operating leverage?
@tags formula, profitability
**% change in operating profit ÷ % change in revenue.** High fixed costs mean high operating leverage: profit swings more than revenue.

## Q: How do you find the weighted average of a mix?
@tags formula
Σ (share of each segment × value of that segment). E.g. 60% at $10 and 40% at $20 → $14.

## Q: Define inventory days (DIO) and receivable days (DSO).
@tags formula, working-capital
- **DIO** = inventory ÷ COGS × 365
- **DSO** = accounts receivable ÷ revenue × 365