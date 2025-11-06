import { describe, it } from "@effect/vitest";
import { Effect, Layer, Schema, Stream, Chunk } from "effect";
import { Model, Stock, Flow, TimeConfig } from "../src/Model.js";
import { simulate } from "../src/Simulation.js";
import { Solver } from "../src/Solver.js";
import { EquationEvaluator } from "../src/Equations.js";
import { UnitManager, UnitDefinition } from "../src/Units.js";
import { StockId, FlowId, ModelId } from "../src/Types.js";

const decodeStockId = Schema.decodeSync(StockId);
const decodeFlowId = Schema.decodeSync(FlowId);
const decodeModelId = Schema.decodeSync(ModelId);

// Custom units for economic model
const economicUnits = [
  new UnitDefinition({ symbol: "tick", dimension: { time: 1 }, factor: 1 }),
  new UnitDefinition({ symbol: "stars", dimension: { github: 1 }, factor: 1 }),
  new UnitDefinition({
    symbol: "downloads",
    dimension: { npm: 1 },
    factor: 1,
  }),
  new UnitDefinition({ symbol: "leads", dimension: { business: 1 }, factor: 1 }),
  new UnitDefinition({
    symbol: "contracts",
    dimension: { business: 1 },
    factor: 1,
  }),
  new UnitDefinition({
    symbol: "points",
    dimension: { reputation: 1 },
    factor: 1,
  }),
  new UnitDefinition({ symbol: "dollars", dimension: { currency: 1 }, factor: 1 }),
];

const solverLayer = Layer.mergeAll(
  UnitManager.layer(economicUnits),
  EquationEvaluator.layer,
  Solver.RK4,
);

describe("Economic Model - Publishing Impact", () => {
  it.effect(
    "should simulate publishing vs not publishing packages",
    () =>
      Effect.gen(function* () {
        // Stock IDs for published scenario
        const publishedStocks = {
          github_stars: decodeStockId("10000000-0000-4000-8000-000000000001"),
          npm_downloads: decodeStockId("10000000-0000-4000-8000-000000000002"),
          consulting_leads: decodeStockId(
            "10000000-0000-4000-8000-000000000003",
          ),
          active_contracts: decodeStockId(
            "10000000-0000-4000-8000-000000000004",
          ),
          reputation_score: decodeStockId(
            "10000000-0000-4000-8000-000000000005",
          ),
          monthly_revenue: decodeStockId("10000000-0000-4000-8000-000000000006"),
          salary_offers: decodeStockId("10000000-0000-4000-8000-000000000007"),
        };

        // Create model for published packages scenario
        const publishedModel = new Model({
          id: decodeModelId("20000000-0000-4000-8000-000000000001"),
          name: "Economic Model - Published Packages",
          stocks: [
            new Stock({
              id: publishedStocks.github_stars,
              name: "GitHubStars",
              initialValue: 50,
              units: "stars",
            }),
            new Stock({
              id: publishedStocks.npm_downloads,
              name: "NpmDownloads",
              initialValue: 100,
              units: "downloads",
            }),
            new Stock({
              id: publishedStocks.consulting_leads,
              name: "ConsultingLeads",
              initialValue: 5,
              units: "leads",
            }),
            new Stock({
              id: publishedStocks.active_contracts,
              name: "ActiveContracts",
              initialValue: 1,
              units: "contracts",
            }),
            new Stock({
              id: publishedStocks.reputation_score,
              name: "ReputationScore",
              initialValue: 60,
              units: "points",
            }),
            new Stock({
              id: publishedStocks.monthly_revenue,
              name: "MonthlyRevenue",
              initialValue: 8000,
              units: "dollars",
            }),
            new Stock({
              id: publishedStocks.salary_offers,
              name: "SalaryOffers",
              initialValue: 120000,
              units: "dollars",
            }),
          ],
          flows: [
            // Stars grow from network effects (exponential growth)
            new Flow({
              id: decodeFlowId("30000000-0000-4000-8000-000000000001"),
              name: "StarAcquisition",
              target: publishedStocks.github_stars,
              rateEquation: "[GitHubStars] * 0.15 / { 1 tick }",
              units: "stars per tick",
            }),
            // Downloads driven by stars (dimensionless conversion)
            new Flow({
              id: decodeFlowId("30000000-0000-4000-8000-000000000002"),
              name: "DownloadRate",
              target: publishedStocks.npm_downloads,
              rateEquation:
                "([GitHubStars] / { 1 stars }) * 2.5 * { 1 downloads } / { 1 tick }",
              units: "downloads per tick",
            }),
            // Leads generated from downloads (conversion)
            new Flow({
              id: decodeFlowId("30000000-0000-4000-8000-000000000003"),
              name: "LeadGeneration",
              target: publishedStocks.consulting_leads,
              rateEquation:
                "([NpmDownloads] / { 1 downloads }) * 0.002 * { 1 leads } / { 1 tick }",
              units: "leads per tick",
            }),
            // Reputation grows with stars (visibility effect)
            new Flow({
              id: decodeFlowId("30000000-0000-4000-8000-000000000004"),
              name: "ReputationGrowth",
              target: publishedStocks.reputation_score,
              rateEquation:
                "([GitHubStars] / { 1 stars }) * 0.02 * { 1 points } / { 1 tick }",
              units: "points per tick",
            }),
            // Leads deplete when converted
            new Flow({
              id: decodeFlowId("30000000-0000-4000-8000-000000000005"),
              name: "LeadConsumption",
              source: publishedStocks.consulting_leads,
              rateEquation:
                "([ConsultingLeads] / { 1 leads }) * ([ReputationScore] / { 1 points }) * 0.001 * { 1 leads } / { 1 tick }",
              units: "leads per tick",
            }),
            // Contracts gained from converted leads
            new Flow({
              id: decodeFlowId("30000000-0000-4000-8000-000000000011"),
              name: "ContractAcquisition",
              target: publishedStocks.active_contracts,
              rateEquation:
                "([ConsultingLeads] / { 1 leads }) * ([ReputationScore] / { 1 points }) * 0.001 * { 1 contracts } / { 1 tick }",
              units: "contracts per tick",
            }),
            // Contract churn
            new Flow({
              id: decodeFlowId("30000000-0000-4000-8000-000000000006"),
              name: "ContractChurn",
              source: publishedStocks.active_contracts,
              rateEquation: "[ActiveContracts] * 0.05 / { 1 tick }",
              units: "contracts per tick",
            }),
            // Revenue growth from contracts
            new Flow({
              id: decodeFlowId("30000000-0000-4000-8000-000000000007"),
              name: "RevenueGrowth",
              target: publishedStocks.monthly_revenue,
              rateEquation:
                "([ActiveContracts] / { 1 contracts }) * 2000 * { 1 dollars } / { 1 tick }",
              units: "dollars per tick",
            }),
            // Revenue decay
            new Flow({
              id: decodeFlowId("30000000-0000-4000-8000-000000000008"),
              name: "RevenueDecay",
              source: publishedStocks.monthly_revenue,
              rateEquation: "[MonthlyRevenue] * 0.02 / { 1 tick }",
              units: "dollars per tick",
            }),
            // Salary offer growth from reputation
            new Flow({
              id: decodeFlowId("30000000-0000-4000-8000-000000000009"),
              name: "SalaryOfferGrowth",
              target: publishedStocks.salary_offers,
              rateEquation:
                "([ReputationScore] / { 1 points }) * 500 * { 1 dollars } / { 1 tick }",
              units: "dollars per tick",
            }),
            // Salary offer decay (offers expire/normalize)
            new Flow({
              id: decodeFlowId("30000000-0000-4000-8000-000000000010"),
              name: "SalaryOfferDecay",
              source: publishedStocks.salary_offers,
              rateEquation: "[SalaryOffers] * 0.01 / { 1 tick }",
              units: "dollars per tick",
            }),
          ],
          variables: [],
          timeConfig: new TimeConfig({ start: 0, end: 24, step: 1 }),
        });

        // Stock IDs for unpublished scenario
        const unpublishedStocks = {
          github_stars: decodeStockId("40000000-0000-4000-8000-000000000001"),
          npm_downloads: decodeStockId("40000000-0000-4000-8000-000000000002"),
          consulting_leads: decodeStockId(
            "40000000-0000-4000-8000-000000000003",
          ),
          active_contracts: decodeStockId(
            "40000000-0000-4000-8000-000000000004",
          ),
          reputation_score: decodeStockId(
            "40000000-0000-4000-8000-000000000005",
          ),
          monthly_revenue: decodeStockId("40000000-0000-4000-8000-000000000006"),
          salary_offers: decodeStockId("40000000-0000-4000-8000-000000000007"),
        };

        // Create model for unpublished scenario (much weaker dynamics)
        const unpublishedModel = new Model({
          id: decodeModelId("50000000-0000-4000-8000-000000000001"),
          name: "Economic Model - Unpublished",
          stocks: [
            new Stock({
              id: unpublishedStocks.github_stars,
              name: "GitHubStars",
              initialValue: 10,
              units: "stars",
            }),
            new Stock({
              id: unpublishedStocks.npm_downloads,
              name: "NpmDownloads",
              initialValue: 0,
              units: "downloads",
            }),
            new Stock({
              id: unpublishedStocks.consulting_leads,
              name: "ConsultingLeads",
              initialValue: 2,
              units: "leads",
            }),
            new Stock({
              id: unpublishedStocks.active_contracts,
              name: "ActiveContracts",
              initialValue: 1,
              units: "contracts",
            }),
            new Stock({
              id: unpublishedStocks.reputation_score,
              name: "ReputationScore",
              initialValue: 40,
              units: "points",
            }),
            new Stock({
              id: unpublishedStocks.monthly_revenue,
              name: "MonthlyRevenue",
              initialValue: 8000,
              units: "dollars",
            }),
            new Stock({
              id: unpublishedStocks.salary_offers,
              name: "SalaryOffers",
              initialValue: 110000,
              units: "dollars",
            }),
          ],
          flows: [
            // Much slower star growth (no public packages)
            new Flow({
              id: decodeFlowId("60000000-0000-4000-8000-000000000001"),
              name: "StarAcquisition",
              target: unpublishedStocks.github_stars,
              rateEquation: "[GitHubStars] * 0.02 / { 1 tick }",
              units: "stars per tick",
            }),
            // Lead generation only from direct network
            new Flow({
              id: decodeFlowId("60000000-0000-4000-8000-000000000002"),
              name: "LeadGeneration",
              target: unpublishedStocks.consulting_leads,
              rateEquation:
                "([ReputationScore] / { 1 points }) * 0.01 * { 1 leads } / { 1 tick }",
              units: "leads per tick",
            }),
            // Slower reputation growth (only from contracts)
            new Flow({
              id: decodeFlowId("60000000-0000-4000-8000-000000000003"),
              name: "ReputationGrowth",
              target: unpublishedStocks.reputation_score,
              rateEquation:
                "([ActiveContracts] / { 1 contracts }) * 0.5 * { 1 points } / { 1 tick }",
              units: "points per tick",
            }),
            // Leads deplete when converted (harder without proof)
            new Flow({
              id: decodeFlowId("60000000-0000-4000-8000-000000000004"),
              name: "LeadConsumption",
              source: unpublishedStocks.consulting_leads,
              rateEquation:
                "([ConsultingLeads] / { 1 leads }) * ([ReputationScore] / { 1 points }) * 0.0005 * { 1 leads } / { 1 tick }",
              units: "leads per tick",
            }),
            // Contracts gained from converted leads
            new Flow({
              id: decodeFlowId("60000000-0000-4000-8000-000000000010"),
              name: "ContractAcquisition",
              target: unpublishedStocks.active_contracts,
              rateEquation:
                "([ConsultingLeads] / { 1 leads }) * ([ReputationScore] / { 1 points }) * 0.0005 * { 1 contracts } / { 1 tick }",
              units: "contracts per tick",
            }),
            // Contract churn
            new Flow({
              id: decodeFlowId("60000000-0000-4000-8000-000000000005"),
              name: "ContractChurn",
              source: unpublishedStocks.active_contracts,
              rateEquation: "[ActiveContracts] * 0.05 / { 1 tick }",
              units: "contracts per tick",
            }),
            // Revenue growth from contracts (lower rates)
            new Flow({
              id: decodeFlowId("60000000-0000-4000-8000-000000000006"),
              name: "RevenueGrowth",
              target: unpublishedStocks.monthly_revenue,
              rateEquation:
                "([ActiveContracts] / { 1 contracts }) * 1500 * { 1 dollars } / { 1 tick }",
              units: "dollars per tick",
            }),
            // Revenue decay
            new Flow({
              id: decodeFlowId("60000000-0000-4000-8000-000000000007"),
              name: "RevenueDecay",
              source: unpublishedStocks.monthly_revenue,
              rateEquation: "[MonthlyRevenue] * 0.02 / { 1 tick }",
              units: "dollars per tick",
            }),
            // Salary offer growth (slower without visibility)
            new Flow({
              id: decodeFlowId("60000000-0000-4000-8000-000000000008"),
              name: "SalaryOfferGrowth",
              target: unpublishedStocks.salary_offers,
              rateEquation:
                "([ReputationScore] / { 1 points }) * 200 * { 1 dollars } / { 1 tick }",
              units: "dollars per tick",
            }),
            // Salary offer decay
            new Flow({
              id: decodeFlowId("60000000-0000-4000-8000-000000000009"),
              name: "SalaryOfferDecay",
              source: unpublishedStocks.salary_offers,
              rateEquation: "[SalaryOffers] * 0.01 / { 1 tick }",
              units: "dollars per tick",
            }),
          ],
          variables: [],
          timeConfig: new TimeConfig({ start: 0, end: 24, step: 1 }),
        });

        // Run both simulations
        const publishedStream = yield* simulate(publishedModel).pipe(
          Effect.provide(solverLayer),
        );
        const unpublishedStream = yield* simulate(unpublishedModel).pipe(
          Effect.provide(solverLayer),
        );

        const publishedChunk = yield* Stream.runCollect(publishedStream);
        const unpublishedChunk = yield* Stream.runCollect(unpublishedStream);

        const publishedStates = Chunk.toReadonlyArray(publishedChunk);
        const unpublishedStates = Chunk.toReadonlyArray(unpublishedChunk);

        // Extract final values
        const publishedFinal = publishedStates[publishedStates.length - 1]!;
        const unpublishedFinal =
          unpublishedStates[unpublishedStates.length - 1]!;

        const pf = {
          stars: publishedFinal.stocks[publishedStocks.github_stars] ?? 0,
          downloads: publishedFinal.stocks[publishedStocks.npm_downloads] ?? 0,
          leads: publishedFinal.stocks[publishedStocks.consulting_leads] ?? 0,
          contracts:
            publishedFinal.stocks[publishedStocks.active_contracts] ?? 0,
          reputation:
            publishedFinal.stocks[publishedStocks.reputation_score] ?? 0,
          revenue: publishedFinal.stocks[publishedStocks.monthly_revenue] ?? 0,
          salary: publishedFinal.stocks[publishedStocks.salary_offers] ?? 0,
        };

        const uf = {
          stars: unpublishedFinal.stocks[unpublishedStocks.github_stars] ?? 0,
          downloads:
            unpublishedFinal.stocks[unpublishedStocks.npm_downloads] ?? 0,
          leads: unpublishedFinal.stocks[unpublishedStocks.consulting_leads] ?? 0,
          contracts:
            unpublishedFinal.stocks[unpublishedStocks.active_contracts] ?? 0,
          reputation:
            unpublishedFinal.stocks[unpublishedStocks.reputation_score] ?? 0,
          revenue:
            unpublishedFinal.stocks[unpublishedStocks.monthly_revenue] ?? 0,
          salary: unpublishedFinal.stocks[unpublishedStocks.salary_offers] ?? 0,
        };

        console.log("\n=== ECONOMIC IMPACT SIMULATION (24 months) ===\n");

        console.log("📦 WITH PUBLISHED PACKAGES:");
        console.log(`  ⭐ GitHub Stars: ${Math.round(pf.stars)}`);
        console.log(`  📥 npm Downloads: ${Math.round(pf.downloads)}`);
        console.log(`  📨 Consulting Leads: ${Math.round(pf.leads)}`);
        console.log(`  🤝 Active Contracts: ${Math.round(pf.contracts)}`);
        console.log(`  🎯 Reputation Score: ${Math.round(pf.reputation)}/100`);
        console.log(`  💰 Monthly Revenue: $${Math.round(pf.revenue)}`);
        console.log(`  💼 Salary Offers: $${Math.round(pf.salary)}`);

        console.log("\n🚫 WITHOUT PUBLISHED PACKAGES:");
        console.log(`  ⭐ GitHub Stars: ${Math.round(uf.stars)}`);
        console.log(`  📥 npm Downloads: ${Math.round(uf.downloads)}`);
        console.log(`  📨 Consulting Leads: ${Math.round(uf.leads)}`);
        console.log(`  🤝 Active Contracts: ${Math.round(uf.contracts)}`);
        console.log(`  🎯 Reputation Score: ${Math.round(uf.reputation)}/100`);
        console.log(`  💰 Monthly Revenue: $${Math.round(uf.revenue)}`);
        console.log(`  💼 Salary Offers: $${Math.round(uf.salary)}`);

        console.log("\n📊 DELTA (Published - Unpublished):");
        console.log(`  ⭐ Stars: +${Math.round(pf.stars - uf.stars)}`);
        console.log(`  📥 Downloads: +${Math.round(pf.downloads - uf.downloads)}`);
        console.log(`  📨 Leads: +${Math.round(pf.leads - uf.leads)}`);
        console.log(
          `  🤝 Contracts: +${Math.round(pf.contracts - uf.contracts)}`,
        );
        console.log(
          `  🎯 Reputation: +${Math.round(pf.reputation - uf.reputation)}`,
        );
        console.log(
          `  💰 Monthly Revenue: +$${Math.round(pf.revenue - uf.revenue)}`,
        );
        console.log(
          `  💼 Salary Offers: +$${Math.round(pf.salary - uf.salary)}`,
        );

        // Calculate cumulative revenue
        const publishedCumulativeRevenue = publishedStates.reduce(
          (sum, state) =>
            sum + (state.stocks[publishedStocks.monthly_revenue] ?? 0),
          0,
        );
        const unpublishedCumulativeRevenue = unpublishedStates.reduce(
          (sum, state) =>
            sum + (state.stocks[unpublishedStocks.monthly_revenue] ?? 0),
          0,
        );

        console.log("\n💵 2-YEAR CUMULATIVE REVENUE:");
        console.log(
          `  Published: $${Math.round(publishedCumulativeRevenue).toLocaleString()}`,
        );
        console.log(
          `  Unpublished: $${Math.round(unpublishedCumulativeRevenue).toLocaleString()}`,
        );
        console.log(
          `  Delta: +$${Math.round(publishedCumulativeRevenue - unpublishedCumulativeRevenue).toLocaleString()}`,
        );

        console.log("\n✅ Model executed successfully\n");
      }),
    { timeout: 30000 },
  );
});
