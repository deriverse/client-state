import {
    BuyMarketSeatReportModel, DepositReportModel, Engine, Instrument, LogMessage,
    LogType, PerpChangeLeverageReportModel, PerpDepositReportModel, PerpFeesReportModel,
    PerpFillOrderReportModel, PerpFundingReportModel, PerpMassCancelReportModel, PerpNewOrderReportModel,
    PerpOrderCancelReportModel, PerpOrderRevokeReportModel, PerpPlaceMassCancelReportModel,
    PerpPlaceOrderReportModel, PerpWithdrawReportModel, SellMarketSeatReportModel, SpotFeesReportModel,
    SpotFillOrderReportModel, SpotMassCancelReportModel, SpotNewOrderReportModel,
    SpotOrderCancelReportModel, SpotOrderRevokeReportModel, SpotPlaceMassCancelReportModel,
    SpotPlaceOrderReportModel, WithdrawReportModel
} from "@deriverse/kit";
import { Address, AddressesByLookupTableAddress, fetchAddressesForLookupTables, GetMultipleAccountsApi, Rpc, Signature, TransactionError } from "@solana/kit";

const IS_LONG_MARGIN_CALL = 0x10;
const IS_SHORT_MARGIN_CALL = 0x20;

export enum OrderSide {
    bid = 0,
    ask = 1
}
export enum Role {
    taker = 0,
    maker = 1
}
export enum TradeDirection {
    buy = 0,
    sell = 1
}
export interface Order {
    orderId: number;
    side: OrderSide;
    assetTokens: number;
    crncyTokens: number;
}
export interface Spot {
    bidOrders: Map<number, Order>;
    askOrders: Map<number, Order>;
    avgPx: number;
    realizedPnl: number;
    assetTokenPosition: number;
    crncyTokenPosition: number;
    assetTokenPending: number;
    crncyTokenPending: number;
    fees: number;
    rebates: number;
    locker: boolean;
    change: boolean;
}
export interface Perp {
    bidOrders: Map<number, Order>;
    askOrders: Map<number, Order>;
    funds: number;
    futures: number;
    leverage: number;
    avgPx: number;
    realizedPnl: number;
    position: number;
    funding: number;
    lossCoverage: number;
    fees: number;
    rebates: number;
    locker: boolean;
    change: boolean;
}
export interface InstrInfo {
    instrId: number;
    assetTokenId: number;
    assetMint: Address;
    crncyTokenId: number;
    crncyMint: Address;
    lut: AddressesByLookupTableAddress;
}
export interface ClientInstrument {
    info: InstrInfo;
    spot: Spot;
    perp: Perp;
}

interface LogsNotifications {
        err: TransactionError | null;
        logs: readonly string[] | null;
        signature: Signature;
}

export function spotInOrdersAssetTokens(clientInstrument: ClientInstrument): number {
    let qty = 0;
    clientInstrument.spot.askOrders.forEach((order, _) => {
        qty += order.assetTokens;
    })
    return qty;
}
export function spotInOrdersCrncyTokens(clientInstrument: ClientInstrument): number {
    let crncy = 0;
    clientInstrument.spot.bidOrders.forEach((order, _) => {
        crncy += order.crncyTokens;
    })
    return crncy;
}
export function perpInOrdersFutures(clientInstrument: ClientInstrument): number {
    let futures = 0;
    clientInstrument.perp.askOrders.forEach((order, _) => {
        futures += order.assetTokens;
    })
    return futures;
}
export function perpInOrdersFunds(clientInstrument: ClientInstrument): number {
    let funds = 0;
    clientInstrument.perp.bidOrders.forEach((order, _) => {
        funds += order.crncyTokens;
    })
    return funds;
}
// null means unreachable
export function perpZeroCollateralPrice(clientInstrument: ClientInstrument): number | null {
    const funds = clientInstrument.perp.funds + perpInOrdersFunds(clientInstrument);
    const futures = clientInstrument.perp.position;
    if (futures == 0 || funds >= 0 && futures >= 0) {
        return null;
    }
    if (futures > 0) {
        return -funds / futures;
    }
    else if (funds < 0) {
        return 0
    }
    else {
        return -funds / futures;
    }
}
// null means no liquidation is impossible
export function perpLiquidationPx(
    instrument: Instrument,
    clientInstrument: ClientInstrument
): number | null {
    const criticalPrice = perpZeroCollateralPrice(clientInstrument);
    if (criticalPrice == null) {
        return null;
    }
    if (clientInstrument.perp.position > 0) {
        return criticalPrice * (1 + instrument.header.liquidationThreshold);
    }
    else {
        return criticalPrice * (1 - instrument.header.liquidationThreshold);
    }
}

export function perpCollateralValue(
    instrument: Instrument,
    clientInstrument: ClientInstrument
): number {
    let px;
    if (clientInstrument.perp.position > 0) {
        px =
            Math.min(instrument.header.perpUnderlyingPx,
                Math.min(
                    instrument.header.perpBestBid, instrument.header.emaPx
                )
            );
    }
    else {
        px =
            Math.max(instrument.header.perpUnderlyingPx,
                Math.max(
                    instrument.header.perpBestAsk, instrument.header.emaPx
                )
            );
    }
    return clientInstrument.perp.position * px +
        clientInstrument.perp.funds +
        perpInOrdersFunds(clientInstrument);
}

function isLongMarginCall(instrument: Instrument): boolean {
    return (instrument.header.mask & IS_LONG_MARGIN_CALL) != 0;
}

function isShortMarginCall(instrument: Instrument): boolean {
    return (instrument.header.mask & IS_SHORT_MARGIN_CALL) != 0;
}

export function perpFundsAvailableforWithdraw(
    instrument: Instrument,
    clientInstrument: ClientInstrument
): number {
    if (clientInstrument.perp.position == 0 && clientInstrument.perp.bidOrders.entries.length == 0 && clientInstrument.perp.askOrders.entries.length == 0) {
        return Math.max(clientInstrument.perp.funds - clientInstrument.perp.lossCoverage, 0);
    }
    else {
        let px;
        if (clientInstrument.perp.position < 0 && isLongMarginCall(instrument)) {
            px =
                Math.max(instrument.header.perpLongSpotPriceForWithdrowal,
                    Math.max(instrument.header.perpUnderlyingPx,
                        Math.max(
                            instrument.header.perpBestAsk, instrument.header.emaPx
                        )
                    )
                );
        }
        else if (clientInstrument.perp.position > 0 && isShortMarginCall(instrument)) {
            px =
                Math.min(instrument.header.perpShortSpotPriceForWithdrowal,
                    Math.min(instrument.header.perpUnderlyingPx,
                        Math.min(
                            instrument.header.perpBestBid, instrument.header.emaPx
                        )
                    )
                );
        }
        else if (clientInstrument.perp.position < 0) {
            px =
                Math.max(instrument.header.perpUnderlyingPx,
                    Math.max(
                        instrument.header.perpBestAsk, instrument.header.emaPx
                    )
                );
        }
        else {
            px =
                Math.min(instrument.header.perpUnderlyingPx,
                    Math.min(
                        instrument.header.perpBestBid, instrument.header.emaPx
                    )
                );
        }
        const futuresValue = clientInstrument.perp.futures * px;
        const positionValue = clientInstrument.perp.position * px;
        const inOrdersFunds = perpInOrdersFunds(clientInstrument);
        return Math.min(
            positionValue + inOrdersFunds * (clientInstrument.perp.leverage - 1) / clientInstrument.perp.leverage,
            positionValue + inOrdersFunds + futuresValue / clientInstrument.perp.leverage
        ) + clientInstrument.perp.funds - clientInstrument.perp.lossCoverage;
    }
}

function perpExposureForShort(
        instrument: Instrument,
    clientInstrument: ClientInstrument
): number {
    return clientInstrument.perp.futures *
        Math.max(instrument.header.perpUnderlyingPx,
            Math.max(
                instrument.header.perpBestAsk, instrument.header.emaPx
            )
        );
}
// null means negative client balance. Liquidation is ongoing
export function perpEffectiveLeverage(
    instrument: Instrument,
    clientInstrument: ClientInstrument
): number | null {
    const evaluation = perpCollateralValue(instrument, clientInstrument);
    if (evaluation <= 0) {
        return null;
    }
    else {
        const margin =
            Math.max(0,
                -Math.min(
                    clientInstrument.perp.funds, perpExposureForShort(instrument, clientInstrument)
                )
            );
        if (clientInstrument.perp.position > 0) {
            return (margin / evaluation) + 1;
        }
        else {
            return margin / evaluation;
        }
    }
}
//null means no risk of liquidaton
export function perpGoodHealthPx(clientInstrument: ClientInstrument): number | null {
    const totalFunds = clientInstrument.perp.funds + perpInOrdersFunds(clientInstrument);
    if (clientInstrument.perp.position > 0) {
        // if margin_funds < 0 else no credit
        // (total_perps * px + total_funds) * leverage = - margin_funds
        // (total_perps * px + total_funds) = - margin_funds / leverage
        // total_perps * px = - margin_funds / leverage - total_funds
        // px = (- margin_funds / leverage - total_funds) / total_perps
        if (clientInstrument.perp.funds < 0) {
            return (-clientInstrument.perp.funds / clientInstrument.perp.leverage - totalFunds) /
                clientInstrument.perp.position;
        } else {
            return null;
        }
    } else if (clientInstrument.perp.position < 0) {
        // (total_perps * px + total_funds) * leverage + margin_perps * px = 0
        // total_perps * leverage * px+ margin_perps * px  + total_funds * leverage = 0
        // px(otal_perps * leverage + margin_perps) + total_funds * leverage = 0
        // px = (- total_funds * leverage) / (total_perps * leverage + margin_perps)
        if (clientInstrument.perp.futures < 0) {
            return (-totalFunds * clientInstrument.perp.leverage) /
                (clientInstrument.perp.position * clientInstrument.perp.leverage +
                    clientInstrument.perp.futures);
        } else {
            return null;
        }
    } else {
        return null;
    }
}
// 1 means 100% health
export function perpHealth(
    instrument: Instrument,
    clientInstrument: ClientInstrument
): number {
    let goodHealthPx = perpGoodHealthPx(clientInstrument);
    if (goodHealthPx == null) {
        return 1;
    }
    const liquidationPx = perpLiquidationPx(instrument, clientInstrument);
    if (liquidationPx == null) {
        return 1;
    }
    if (clientInstrument.perp.position > 0) {
        if (instrument.header.perpUnderlyingPx <= liquidationPx) {
            return 0;
        }
        else {
            return Math.min(1,
                (instrument.header.perpUnderlyingPx - liquidationPx) / (goodHealthPx - liquidationPx)
            );
        }
    } else if (clientInstrument.perp.position < 0) {       
        if (instrument.header.perpUnderlyingPx >= liquidationPx) {
            return 0;
        }
        else {
            return Math.min(1,
                (liquidationPx - instrument.header.perpUnderlyingPx) / (liquidationPx - goodHealthPx)
            );
        }
    } else {
        return 1;
    }
}

export type LoadSpotInstrStatistics = (instrId: number) => Promise<void>;
export type WriteSpotInstrStatistics = (instrId: number) => Promise<void>;
export type OnError = (report: LogMessage, error: string) => Promise<void>;
export type OnSpotFees = (instrId: number, report: SpotFeesReportModel) => void;
export type OnPerpFees = (instrId: number, report: PerpFeesReportModel) => void;
export type OnDeposit = (depositReport: DepositReportModel, lastWithdrawalReport: WithdrawReportModel | null) => void;
export type OnWithdraw = (withdrawReport: WithdrawReportModel, lastDepositReport: DepositReportModel | null) => void;
export type OnSpotPlaceOrder = (placeOrderReport: SpotPlaceOrderReportModel) => void;
export type OnPerpPlaceOrder = (placeOrderReport: PerpPlaceOrderReportModel) => void;
export type OnFillOrder = (
    instrId: number,
    role: Role,
    tradeDirection: TradeDirection,
    takerOrderId: number,
    report: LogMessage
) => void;
const loadSpotInstrStatisticsDummy = async (instrId: number) => { };
const writeSpotInstrStatisticsDummy = async (instrId: number) => { };
const onErrorDummy = async (report: LogMessage, error: string) => { };
const onSpotFeesDummy = (instrId: number, report: SpotFeesReportModel) => { };
const onPerpFeesDummy = (instrId: number, report: PerpFeesReportModel) => { };
const onDepositDummy = (depositReport: DepositReportModel, lastWithdrawalReport: WithdrawReportModel | null) => { };
const onWithdrawDummy = (withdrawReport: WithdrawReportModel, lastDepositReport: DepositReportModel | null) => { };
const onSpotPlaceOrderDummy = (placeOrderReport: SpotPlaceOrderReportModel) => { };
const onPerpPlaceOrderDummy = (placeOrderReport: PerpPlaceOrderReportModel) => { };
const onFillOrderDummy = (
    instrId: number,
    role: Role,
    tradeDirection: TradeDirection,
    takerOrderId: number,
    report: LogMessage
) => { };

export async function createClientState(
    args: {
        engine: Engine,
        rpc: Rpc<GetMultipleAccountsApi>,
        instrIds: number[],
        loadSpotInstrStatistics?: LoadSpotInstrStatistics,
        writeSpotInstrStatistics?: WriteSpotInstrStatistics,
        onError?: OnError,
        onSpotFees?: OnSpotFees,
        onPerpFees?: OnPerpFees,
        onDeposit?: OnDeposit,
        onWithdraw?: OnWithdraw,
        onSpotPlaceOrder?: OnSpotPlaceOrder,
        onSpotFillOrder?: OnFillOrder,
        onPerpPlaceOrder?: OnPerpPlaceOrder,
        onPerpFillOrder?: OnFillOrder
    }
): Promise<ClientState | null> {
    let clientOpsState = new ClientState(
        new Map(), new Map(),
        args.loadSpotInstrStatistics??loadSpotInstrStatisticsDummy,
        args.writeSpotInstrStatistics??writeSpotInstrStatisticsDummy,
        args.onError ?? onErrorDummy,
        args.onSpotFees ?? onSpotFeesDummy,
        args.onPerpFees??onPerpFeesDummy,
        args.onDeposit??onDepositDummy,
        args.onWithdraw??onWithdrawDummy,
        args.onSpotPlaceOrder??onSpotPlaceOrderDummy,
        args.onSpotFillOrder??onFillOrderDummy,
        args.onPerpPlaceOrder??onPerpPlaceOrderDummy,
        args.onPerpFillOrder??onFillOrderDummy
    );
    const clientData = await args.engine.getClientData();
    for (const token of clientData.tokens.values()) {
        clientOpsState.tokens.set(token.tokenId, token.amount);  
    }
    for (const instrId of args.instrIds) {
        let instr = args.engine.instruments.get(instrId);
        if (instr != null) {
            const assetTokenId = instr!.header.assetTokenId;
            const crncyTokenId = instr!.header.crncyTokenId;
            await args.engine.updateInstrData({ instrId: instrId });
            instr = args.engine.instruments.get(instrId);
            clientOpsState.instruments.set(instrId, {
                info: {
                    instrId: instrId,
                    assetTokenId: assetTokenId,
                    crncyTokenId: crncyTokenId,
                    assetMint: instr!.header.assetMint,
                    crncyMint: instr!.header.crncyMint,
                    lut: await fetchAddressesForLookupTables(
                          [args.engine.rootStateModel.lutAddress, args.engine.clientLutAddress, instr!.header.lutAddress],
                          args.rpc
                        )
                },
                spot: {
                    bidOrders: new Map(),
                    askOrders: new Map(),
                    assetTokenPosition: clientData.tokens.get(assetTokenId)!.amount,
                    crncyTokenPosition: clientData.tokens.get(crncyTokenId)!.amount,
                    assetTokenPending: 0,
                    crncyTokenPending: 0,
                    avgPx: 0,
                    realizedPnl: 0,
                    fees: 0,
                    rebates: 0,
                    locker: false,
                    change: true
                },
                perp: {
                    bidOrders: new Map(),
                    askOrders: new Map(),
                    position: 0,
                    avgPx: 0,
                    realizedPnl: 0,
                    fees: 0,
                    rebates: 0,
                    leverage: 0,
                    funding: 0,
                    funds: 0,
                    futures: 0,
                    lossCoverage: 0,
                    locker: false,
                    change: true
                },
            });
            if (clientData.spot.size > 0) {
                return null;
            }
            for (const perp of clientData.perp) {
                if (perp[1].instrId == instrId) {
                    const ordersInfo = await args.engine.getClientPerpOrdersInfo(perp[1]);
                    let clientInstrument = clientOpsState.instruments.get(instrId)!;
                    clientInstrument.perp.leverage = ordersInfo.mask & 0xFF;
                    clientInstrument.perp.futures = ordersInfo.perps + ordersInfo.inOrdersPerps;
                    clientInstrument.perp.position = clientInstrument.perp.futures;
                    clientInstrument.perp.funds = ordersInfo.funds + ordersInfo.inOrdersFunds;
                    clientInstrument.perp.funding = ordersInfo.fundingFunds;
                    clientInstrument.perp.lossCoverage = ordersInfo.lossCoverage;
                    clientInstrument.perp.fees = ordersInfo.fees;
                    clientInstrument.perp.rebates = ordersInfo.rebates;
                    clientInstrument.perp.avgPx = ordersInfo.cost/clientInstrument.perp.position;
                    if (ordersInfo.bidsCount > 0 || ordersInfo.asksCount > 0) {
                        return null;
                    }
                    break;
                }
            }
        }
        else {
            return null;
        }
    }
    return clientOpsState;
}

export class ClientState {
    instruments: Map<number, ClientInstrument>;
    tokens: Map<number, number>;
    loadSpotInstrStatistics: LoadSpotInstrStatistics;
    writeSpotInstrStatistics: WriteSpotInstrStatistics;
    onError: OnError;
    onSpotFees: OnSpotFees;
    onPerpFees: OnPerpFees;
    onDeposit: OnDeposit;
    onWithdraw: OnWithdraw;
    onSpotPlaceOrder: OnSpotPlaceOrder;
    onSpotFillOrder: OnFillOrder;
    onPerpPlaceOrder: OnPerpPlaceOrder;
    onPerpFillOrder: OnFillOrder;
    constructor(
        instruments: Map<number, ClientInstrument>,
        tokens: Map<number, number>,
        loadSpotInstrStatistics: LoadSpotInstrStatistics,
        writeSpotInstrStatistics: WriteSpotInstrStatistics,
        onError: OnError,
        onSpotFees: OnSpotFees,
        onPerpFees: OnPerpFees,
        onDeposit: OnDeposit,
        onWithdraw: OnWithdraw,
        onSpotPlaceOrder: OnSpotPlaceOrder,
        onSpotFillOrder: OnFillOrder,
        onPerpPlaceOrder: OnPerpPlaceOrder,
        onPerpFillOrder: OnFillOrder
    ) {
        this.instruments = instruments;
        this.tokens = tokens;
        this.loadSpotInstrStatistics = loadSpotInstrStatistics;
        this.writeSpotInstrStatistics = writeSpotInstrStatistics;
        this.onError = onError;
        this.onSpotFees = onSpotFees;
        this.onPerpFees = onPerpFees;
        this.onDeposit = onDeposit;
        this.onWithdraw = onWithdraw;
        this.onSpotPlaceOrder = onSpotPlaceOrder;
        this.onSpotFillOrder = onSpotFillOrder;
        this.onPerpPlaceOrder = onPerpPlaceOrder;
        this.onPerpFillOrder = onPerpFillOrder;
    }
    async writeSpotStatistics() {
        for (const instr of this.instruments.entries()) {
            await this.writeSpotInstrStatistics(instr[1].info.instrId);
        }
    }
    async loadSpotStatistics() {
        for (const instr of this.instruments.entries()) {
            await this.loadSpotInstrStatistics(instr[1].info.instrId);
        }
    }
    private spotFill(
        instrument: ClientInstrument,
        role: Role,
        tradeDirection: TradeDirection,
        takerOrderId: number,
        report: SpotFillOrderReportModel,
    ) {
        const qty = tradeDirection == TradeDirection.buy ? report.qty : -report.qty;
        const crncy = tradeDirection == TradeDirection.buy ? -report.crncy : report.crncy;
        if (instrument.spot.assetTokenPosition * qty < 0) {
            const price = report.crncy / report.qty;
            if (Math.abs(instrument.spot.assetTokenPosition) >= Math.abs(qty)) {
                instrument.spot.realizedPnl += (instrument.spot.avgPx - price) * qty;
            }
            else {
                instrument.spot.realizedPnl -= (instrument.spot.avgPx - price) *
                    instrument.spot.assetTokenPosition;
                instrument.spot.avgPx = price;
            }
        }
        else {
            const newPosition = instrument.spot.assetTokenPosition + qty;
            instrument.spot.avgPx = (Math.abs(instrument.spot.assetTokenPosition) *
                instrument.spot.avgPx + report.crncy) / Math.abs(newPosition);
        }
        if (role == Role.maker) {
            const rebates = report.rebates ?? 0;
            instrument.spot.realizedPnl += rebates;
            instrument.spot.rebates += rebates;
            instrument.spot.crncyTokenPosition += rebates;

        }
        if (tradeDirection == TradeDirection.buy) {
            const token = this.tokens.get(instrument.info.assetTokenId) ?? 0;
            this.tokens.set(instrument.info.assetTokenId, token + report.qty);
            if (role == Role.taker) {
                const token = this.tokens.get(instrument.info.crncyTokenId);
                if (token == null) {
                    this.onError(report, "Currency token not found");
                    return;
                }
                this.tokens.set(instrument.info.crncyTokenId, token - report.crncy);
            }
        }
        else {
            const token = this.tokens.get(instrument.info.crncyTokenId) ?? 0;
            this.tokens.set(instrument.info.crncyTokenId, token + report.crncy);
            if (role == Role.taker) {
                const token = this.tokens.get(instrument.info.assetTokenId);
                if (token == null) {
                    this.onError(report, "Asset token not found");
                    return;
                }
                this.tokens.set(instrument.info.assetTokenId, token - report.qty);
            }
        }
        instrument.spot.assetTokenPosition += qty;
        instrument.spot.crncyTokenPosition += crncy;
        this.onSpotFillOrder(instrument.info.instrId, role, tradeDirection, takerOrderId, report);
    }

    private perpFill(
        instrument: ClientInstrument,
        role: Role,
        tradeDirection: TradeDirection,
        takerOrderId: number,
        report: PerpFillOrderReportModel,
    ) {
        const qty = tradeDirection == TradeDirection.buy ? report.perps : -report.perps;
        //const crncy = tradeDirection == TradeDirection.buy ? -report.crncy : report.crncy;
        if (instrument.perp.position * qty < 0) {
            const price = report.crncy / report.perps;
            if (Math.abs(instrument.perp.position) >= Math.abs(qty)) {
                instrument.perp.realizedPnl += (instrument.perp.avgPx - price) * qty;
                instrument.perp.position += qty;
            }
            else {
                instrument.perp.realizedPnl -= (instrument.perp.avgPx - price) * instrument.perp.position;
                instrument.perp.position += qty;
                instrument.perp.avgPx = price;
            }
        }
        else {
            const newPosition = instrument.perp.position + qty;
            instrument.perp.avgPx = (Math.abs(instrument.perp.position) * instrument.perp.avgPx + report.crncy) / Math.abs(newPosition);
            instrument.perp.position = newPosition;
        }
        if (role == Role.maker) {
            const rebates = report.rebates ?? 0;
            instrument.perp.realizedPnl += rebates;
            instrument.perp.rebates += rebates;
        }
        if (tradeDirection == TradeDirection.buy) {
            instrument.perp.futures += report.perps;
            if (role == Role.taker) {
                instrument.perp.funds -= report.crncy;
            }
        }
        else {
            instrument.perp.funds += report.crncy;
            if (role == Role.taker) {
                instrument.perp.futures -= report.perps;
            }
        }
        this.onPerpFillOrder(instrument.info.instrId, role, tradeDirection, takerOrderId, report);
    }

    update(
        engine: Engine,
        logsNotifications: LogsNotifications | null
    ) {
        if (logsNotifications
            && logsNotifications.logs
            && logsNotifications.signature != "1111111111111111111111111111111111111111111111111111111111111111") {
            const logs = engine.logsDecode(logsNotifications.logs);
            if (logs && logsNotifications.err == null) {
                let takerClientId = -1;
                let instrId = -1;
                let takerOrderId = -1;
                let lastDepositReport: DepositReportModel | null = null;
                let lastWithdrawReport: WithdrawReportModel | null = null;
                for (const report of logs) {
                    switch (report.tag) {
                        case LogType.deposit: {
                            const depositReport = report as DepositReportModel;
                            if (depositReport.clientId == engine.originalClientId) {
                                const token = this.tokens.get(depositReport.tokenId) ?? 0;
                                this.tokens.set(depositReport.tokenId, token + depositReport.amount);
                                this.onDeposit(depositReport, lastWithdrawReport);
                                lastDepositReport = depositReport;
                            }
                            break;
                        }
                        case LogType.withdraw: {
                            const withdrawReport = report as WithdrawReportModel;
                            if (withdrawReport.clientId == engine.originalClientId) {
                                const token = this.tokens.get(withdrawReport.tokenId) ?? 0;
                                this.tokens.set(withdrawReport.tokenId, token - withdrawReport.amount);
                                this.onWithdraw(withdrawReport, lastDepositReport);
                                lastWithdrawReport = withdrawReport;
                            }
                            break;
                        }
                        case LogType.perpDeposit: {
                            const perpDepositReport = report as PerpDepositReportModel;
                            if (perpDepositReport.clientId == engine.originalClientId) {
                                const clientInstrument = this.instruments.get(perpDepositReport.instrId);
                                if (clientInstrument == null) {
                                    this.onError(report, "Instrument not found");
                                    break;
                                }
                                const token = this.tokens.get(clientInstrument.info.crncyTokenId);
                                if (token == null) {
                                    this.onError(report, "Currency token not found");
                                    break;
                                }
                                this.tokens.set(clientInstrument.info.crncyTokenId, token - perpDepositReport.amount);
                                clientInstrument.perp.funds += perpDepositReport.amount;
                            }
                            break;
                        }
                        case LogType.perpWithdraw: {
                            const perpWithdrawReport = report as PerpWithdrawReportModel;
                            if (perpWithdrawReport.clientId == engine.originalClientId) {
                                const clientInstrument = this.instruments.get(perpWithdrawReport.instrId);
                                if (clientInstrument == null) {
                                    this.onError(report, "Instrument not found");
                                    break;
                                }
                                const token = this.tokens.get(clientInstrument.info.crncyTokenId) ?? 0;
                                this.tokens.set(clientInstrument.info.crncyTokenId, token + perpWithdrawReport.amount);
                                clientInstrument.perp.funds -= perpWithdrawReport.amount;
                            }
                            break;
                        }
                        case LogType.spotPlaceOrder: {
                            const spotPlaceOrderReport = report as SpotPlaceOrderReportModel;
                            takerClientId = spotPlaceOrderReport.clientId;
                            if (takerClientId == engine.originalClientId) {
                                this.onSpotPlaceOrder(spotPlaceOrderReport);
                            }
                            takerOrderId = spotPlaceOrderReport.orderId;
                            instrId = spotPlaceOrderReport.instrId;
                            break;
                        }
                        case LogType.perpPlaceOrder: {
                            const perpPlaceOrderReport = report as PerpPlaceOrderReportModel;
                            takerClientId = perpPlaceOrderReport.clientId;
                            if (takerClientId == engine.originalClientId) {
                                this.onPerpPlaceOrder(perpPlaceOrderReport);
                            }
                            takerOrderId = perpPlaceOrderReport.orderId;
                            instrId = perpPlaceOrderReport.instrId;
                            break;
                        }
                        case LogType.spotFillOrder: {
                            const spotFillOrderReport = report as SpotFillOrderReportModel;
                            if (takerClientId == engine.originalClientId ||
                                spotFillOrderReport.clientId == engine.originalClientId) {
                                let clientInstrument = this.instruments.get(instrId);
                                if (clientInstrument == null) {
                                    this.onError(report, "Instrument not found");
                                    break;
                                }
                                clientInstrument.spot.change = true;
                                if (takerClientId == engine.originalClientId) {
                                    if (spotFillOrderReport.side == 0) {
                                        this.spotFill(clientInstrument, Role.taker, TradeDirection.sell,
                                            takerOrderId, spotFillOrderReport);
                                    }
                                    else {
                                        this.spotFill(clientInstrument, Role.taker, TradeDirection.buy,
                                            takerOrderId, spotFillOrderReport);
                                    }
                                }
                                else if (spotFillOrderReport.side == 0) {
                                    const order = clientInstrument.spot.bidOrders.
                                        get(spotFillOrderReport.orderId);
                                    if (order != null) {
                                        if (order.assetTokens == spotFillOrderReport.qty) {
                                            clientInstrument.spot.bidOrders.
                                                delete(spotFillOrderReport.orderId)
                                        }
                                        else {
                                            order.assetTokens -= spotFillOrderReport.qty;
                                            order.crncyTokens -= spotFillOrderReport.crncy;
                                        }
                                    }
                                    else {
                                        this.onError(report, "Maker order not found");
                                        break;
                                    }
                                    this.spotFill(clientInstrument, Role.maker, TradeDirection.buy,
                                        takerOrderId, spotFillOrderReport);
                                }
                                else {
                                    const order = clientInstrument.spot.askOrders.
                                        get(spotFillOrderReport.orderId);
                                    if (order != null) {
                                        if (order.assetTokens == spotFillOrderReport.qty) {
                                            clientInstrument.spot.askOrders.
                                                delete(spotFillOrderReport.orderId)
                                        }
                                        else {
                                            order.assetTokens -= spotFillOrderReport.qty;
                                            order.crncyTokens -= spotFillOrderReport.crncy;
                                        }
                                    }
                                    else {
                                        this.onError(report, "Maker order not found");
                                        break;
                                    }
                                    this.spotFill(clientInstrument, Role.maker, TradeDirection.sell,
                                        takerOrderId, spotFillOrderReport);
                                }
                            }
                            break;
                        }
                        case LogType.perpFillOrder: {
                            const perpFillOrderReport = report as PerpFillOrderReportModel;
                            if (takerClientId == engine.originalClientId ||
                                perpFillOrderReport.clientId == engine.originalClientId) {
                                let clientInstrument = this.instruments.get(instrId);
                                if (clientInstrument == null) {
                                    this.onError(report, "Instrument not found");
                                    break;
                                }
                                clientInstrument.perp.change = true;
                                if (takerClientId == engine.originalClientId) {
                                    if (perpFillOrderReport.side == 0) {
                                        this.perpFill(clientInstrument, Role.taker, TradeDirection.sell,
                                            takerOrderId, perpFillOrderReport);
                                    }
                                    else {
                                        this.perpFill(clientInstrument, Role.taker, TradeDirection.buy,
                                            takerOrderId, perpFillOrderReport);
                                    }
                                }
                                else if (perpFillOrderReport.side == 0) {
                                    const order = clientInstrument.perp.bidOrders.
                                        get(perpFillOrderReport.orderId);
                                    if (order != null) {
                                        if (order.assetTokens == perpFillOrderReport.perps) {
                                            clientInstrument.perp.bidOrders.
                                                delete(perpFillOrderReport.orderId)
                                        }
                                        else {
                                            order.assetTokens -= perpFillOrderReport.perps;
                                            order.crncyTokens -= perpFillOrderReport.crncy;
                                        }
                                    }
                                    else {
                                        this.onError(report, "Maker order not found");
                                        break;
                                    }
                                    this.perpFill(clientInstrument, Role.maker, TradeDirection.buy,
                                        takerOrderId, perpFillOrderReport);
                                }
                                else {
                                    const order = clientInstrument.perp.askOrders.
                                        get(perpFillOrderReport.orderId);
                                    if (order != null) {
                                        if (order.assetTokens == perpFillOrderReport.perps) {
                                            clientInstrument.perp.askOrders.
                                                delete(perpFillOrderReport.orderId)
                                        }
                                        else {
                                            order.assetTokens -= perpFillOrderReport.perps;
                                            order.crncyTokens -= perpFillOrderReport.crncy;
                                        }
                                    }
                                    else {
                                        this.onError(report, "Maker order not found");
                                        break;
                                    }
                                    this.perpFill(clientInstrument, Role.maker, TradeDirection.sell,
                                        takerOrderId, perpFillOrderReport);
                                }
                            }
                            break;
                        }
                        case LogType.spotNewOrder: {
                            if (takerClientId == engine.originalClientId) {
                                const spotNewOrderReport = report as SpotNewOrderReportModel;
                                let clientInstrument = this.instruments.get(instrId);
                                if (clientInstrument == null) {
                                    this.onError(report, "Instrument not found");
                                    break;
                                }
                                clientInstrument.spot.change = true;
                                if (spotNewOrderReport.side == 0) {
                                    clientInstrument.spot.bidOrders.set(takerOrderId,
                                        {
                                            orderId: takerOrderId,
                                            assetTokens: spotNewOrderReport.qty,
                                            crncyTokens: spotNewOrderReport.crncy,
                                            side: OrderSide.bid
                                        }
                                    )
                                    const token = this.tokens.get(clientInstrument.info.crncyTokenId);
                                    if (token == null) {
                                        this.onError(report, "Currency token not found");
                                        break;
                                    }
                                    this.tokens.set(clientInstrument.info.crncyTokenId,
                                        token - spotNewOrderReport.crncy);
                                }
                                else {
                                    clientInstrument.spot.askOrders.set(takerOrderId,
                                        {
                                            orderId: takerOrderId,
                                            assetTokens: spotNewOrderReport.qty,
                                            crncyTokens: spotNewOrderReport.crncy,
                                            side: OrderSide.ask
                                        }
                                    )
                                    const token = this.tokens.get(clientInstrument.info.assetTokenId);
                                    if (token == null) {
                                        this.onError(report, "Asset token not found");
                                        break;
                                    }
                                    this.tokens.set(clientInstrument.info.assetTokenId,
                                        token - spotNewOrderReport.qty);
                                }
                            }
                            break;
                        }
                        case LogType.perpNewOrder: {
                            if (takerClientId == engine.originalClientId) {
                                const perpNewOrderReport = report as PerpNewOrderReportModel;
                                let clientInstrument = this.instruments.get(instrId);
                                if (clientInstrument == null) {
                                    this.onError(report, "Instrument not found");
                                    break;
                                }
                                clientInstrument.perp.change = true;
                                if (perpNewOrderReport.side == 0) {
                                    clientInstrument.perp.bidOrders.set(takerOrderId,
                                        {
                                            orderId: takerOrderId,
                                            assetTokens: perpNewOrderReport.perps,
                                            crncyTokens: perpNewOrderReport.crncy,
                                            side: OrderSide.bid
                                        }
                                    )
                                    clientInstrument.perp.funds -= perpNewOrderReport.crncy;
                                }
                                else {
                                    clientInstrument.perp.askOrders.set(takerOrderId,
                                        {
                                            orderId: takerOrderId,
                                            assetTokens: perpNewOrderReport.perps,
                                            crncyTokens: perpNewOrderReport.crncy,
                                            side: OrderSide.ask
                                        }
                                    )
                                    clientInstrument.perp.futures -= perpNewOrderReport.perps;
                                }
                            }
                            break;
                        }
                        case LogType.spotFees: {
                            const spotFeesReport = report as SpotFeesReportModel;
                            if (takerClientId == engine.originalClientId) {
                                let clientInstrument = this.instruments.get(instrId);
                                if (clientInstrument == null) {
                                    this.onError(report, "Instrument not found");
                                    break;
                                }
                                let token = this.tokens.get(clientInstrument.info.crncyTokenId) ?? 0;
                                this.tokens.set(clientInstrument.info.crncyTokenId,
                                    token + spotFeesReport.fees);
                                clientInstrument.spot.realizedPnl -= spotFeesReport.fees;
                                clientInstrument.spot.fees += spotFeesReport.fees;
                                this.onSpotFees(instrId, spotFeesReport);
                            }
                            break;
                        }
                        case LogType.perpFees: {
                            const perpFeesReport = report as PerpFeesReportModel;
                            if (takerClientId == engine.originalClientId) {
                                let clientInstrument = this.instruments.get(instrId);
                                if (clientInstrument == null) {
                                    this.onError(report, "Instrument not found");
                                    break;
                                }
                                clientInstrument.perp.funds -= perpFeesReport.fees;
                                clientInstrument.perp.realizedPnl -= perpFeesReport.fees;
                                clientInstrument.perp.fees += perpFeesReport.fees;
                                this.onPerpFees(instrId, perpFeesReport);
                            }
                            break;
                        }
                        case LogType.spotOrderCancel: {
                            const spotOrderCancelReport = report as SpotOrderCancelReportModel;
                            if (spotOrderCancelReport.clientId == engine.originalClientId) {
                                let clientInstrument = this.instruments.
                                    get(spotOrderCancelReport.instrId);
                                if (clientInstrument == null) {
                                    this.onError(report, "Instrument not found");
                                    break;
                                }
                                clientInstrument.spot.change = true;
                                if (spotOrderCancelReport.side == 0) {
                                    const order = clientInstrument.spot.bidOrders.
                                        get(spotOrderCancelReport.orderId);
                                    if (order == null) {
                                        this.onError(report, "Order not found");
                                        break;
                                    }
                                    clientInstrument.spot.bidOrders.delete(spotOrderCancelReport.orderId);
                                    let token = this.tokens.get(clientInstrument.info.crncyTokenId) ?? 0;
                                    this.tokens.set(clientInstrument.info.crncyTokenId,
                                        token + spotOrderCancelReport.crncy);
                                }
                                else {
                                    const order = clientInstrument.spot.askOrders.
                                        get(spotOrderCancelReport.orderId);
                                    if (order == null) {
                                        this.onError(report, "Order not found");
                                        break;
                                    }
                                    clientInstrument.spot.askOrders.delete(spotOrderCancelReport.orderId);
                                    let token = this.tokens.get(clientInstrument.info.assetTokenId) ?? 0;
                                    this.tokens.set(clientInstrument.info.assetTokenId,
                                        token + spotOrderCancelReport.qty);
                                }
                            }
                            break;
                        }
                        case LogType.perpOrderCancel: {
                            const perpOrderCancelReport = report as PerpOrderCancelReportModel;
                            if (perpOrderCancelReport.clientId == engine.originalClientId) {
                                let clientInstrument = this.instruments.
                                    get(perpOrderCancelReport.instrId);
                                if (clientInstrument == null) {
                                    this.onError(report, "Instrument not found");
                                    break;
                                }
                                clientInstrument.perp.change = true;
                                if (perpOrderCancelReport.side == 0) {
                                    const order = clientInstrument.perp.bidOrders.
                                        get(perpOrderCancelReport.orderId);
                                    if (order == null) {
                                        this.onError(report, "Perp order not found");
                                        break;
                                    }
                                    clientInstrument.perp.bidOrders.delete(perpOrderCancelReport.orderId);
                                    clientInstrument.perp.funds += perpOrderCancelReport.crncy;
                                }
                                else {
                                    const order = clientInstrument.perp.askOrders.
                                        get(perpOrderCancelReport.orderId);
                                    if (order == null) {
                                        this.onError(report, "Perp order not found");
                                        break;
                                    }
                                    clientInstrument.perp.askOrders.delete(perpOrderCancelReport.orderId);
                                    clientInstrument.perp.futures += perpOrderCancelReport.perps;
                                }
                            }
                            break;
                        }
                        case LogType.spotOrderRevoke: {
                            const spotOrderRevokeReport = report as SpotOrderRevokeReportModel;
                            if (spotOrderRevokeReport.clientId == engine.originalClientId) {
                                let clientInstrument = this.instruments.
                                    get(instrId);
                                if (clientInstrument == null) {
                                    this.onError(report, "Instrument not found");
                                    break;
                                }
                                clientInstrument.spot.change = true;
                                if (spotOrderRevokeReport.side == 0) {
                                    const order = clientInstrument.spot.bidOrders.
                                        get(spotOrderRevokeReport.orderId);
                                    if (order == null) {
                                        this.onError(report, "Order not found");
                                        break;
                                    }
                                    clientInstrument.spot.bidOrders.delete(spotOrderRevokeReport.orderId);
                                    let token = this.tokens.get(clientInstrument.info.crncyTokenId) ?? 0;
                                    this.tokens.set(clientInstrument.info.crncyTokenId,
                                        token + spotOrderRevokeReport.crncy);
                                }
                                else {
                                    const order = clientInstrument.spot.askOrders.
                                        get(spotOrderRevokeReport.orderId);
                                    if (order == null) {
                                        this.onError(report, "Order not found");
                                        break;
                                    }
                                    clientInstrument.spot.askOrders.delete(spotOrderRevokeReport.orderId);
                                    let token = this.tokens.get(clientInstrument.info.assetTokenId) ?? 0;
                                    this.tokens.set(clientInstrument.info.assetTokenId,
                                        token + spotOrderRevokeReport.qty);
                                }
                            }
                            break;
                        }
                        case LogType.perpOrderRevoke: {
                            const perpOrderRevokeReport = report as PerpOrderRevokeReportModel;
                            if (perpOrderRevokeReport.clientId == engine.originalClientId) {
                                let clientInstrument = this.instruments.
                                    get(instrId);
                                if (clientInstrument == null) {
                                    this.onError(report, "Instrument not found");
                                    break;
                                }
                                clientInstrument.perp.change = true;
                                if (perpOrderRevokeReport.side == 0) {
                                    const order = clientInstrument.perp.bidOrders.
                                        get(perpOrderRevokeReport.orderId);
                                    if (order == null) {
                                        this.onError(report, "Perp Order not found");
                                        break;
                                    }
                                    clientInstrument.perp.bidOrders.delete(perpOrderRevokeReport.orderId);
                                    clientInstrument.perp.funds += perpOrderRevokeReport.crncy;
                                }
                                else {
                                    const order = clientInstrument.perp.askOrders.
                                        get(perpOrderRevokeReport.orderId);
                                    if (order == null) {
                                        this.onError(report, "Perp Order not found");
                                        break;
                                    }
                                    clientInstrument.perp.askOrders.delete(perpOrderRevokeReport.orderId);
                                    clientInstrument.perp.futures += perpOrderRevokeReport.perps;
                                }
                            }
                            break;
                        }
                        case LogType.spotPlaceMassCancel: {
                            const spotPlaceMassCancelReport = report as SpotPlaceMassCancelReportModel;
                            takerClientId = spotPlaceMassCancelReport.clientId;
                            instrId = spotPlaceMassCancelReport.instrId;
                            break;
                        }
                        case LogType.perpPlaceMassCancel: {
                            const perpPlaceMassCancelReport = report as PerpPlaceMassCancelReportModel;
                            takerClientId = perpPlaceMassCancelReport.clientId;
                            instrId = perpPlaceMassCancelReport.instrId
                            break;
                        }
                        case LogType.spotMassCancel: {
                            const spotMassCancelReport = report as SpotMassCancelReportModel;
                            if (takerClientId == engine.originalClientId) {
                                let clientInstrument = this.instruments.
                                    get(instrId);
                                if (clientInstrument == null) {
                                    this.onError(report, "Instrument not found");
                                    break;
                                }
                                clientInstrument.spot.change = true;
                                if (spotMassCancelReport.side == 0) {
                                    const order = clientInstrument.spot.bidOrders.
                                        get(spotMassCancelReport.orderId);
                                    if (order == null) {
                                        this.onError(report, "Order not found");
                                        break;
                                    }
                                    clientInstrument.spot.bidOrders.delete(spotMassCancelReport.orderId);
                                    let token = this.tokens.get(clientInstrument.info.crncyTokenId) ?? 0;
                                    this.tokens.set(clientInstrument.info.crncyTokenId,
                                        token + spotMassCancelReport.crncy);
                                }
                                else {
                                    const order = clientInstrument.spot.askOrders.
                                        get(spotMassCancelReport.orderId);
                                    if (order == null) {
                                        this.onError(report, "Order not found");
                                        break;
                                    }
                                    clientInstrument.spot.askOrders.delete(spotMassCancelReport.orderId);
                                    let token = this.tokens.get(clientInstrument.info.assetTokenId) ?? 0;
                                    this.tokens.set(clientInstrument.info.assetTokenId,
                                        token + spotMassCancelReport.qty);
                                }
                            }
                            break;
                        }
                        case LogType.perpMassCancel: {
                            const perpMassCancelReport = report as PerpMassCancelReportModel;
                            if (takerClientId == engine.originalClientId) {
                                let clientInstrument = this.instruments.
                                    get(instrId);
                                if (clientInstrument == null) {
                                    this.onError(report, "Instrument not found");
                                    break;
                                }
                                clientInstrument.perp.change = true;
                                if (perpMassCancelReport.side == 0) {
                                    const order = clientInstrument.spot.bidOrders.
                                        get(perpMassCancelReport.orderId);
                                    if (order == null) {
                                        this.onError(report, "Order not found");
                                        break;
                                    }
                                    clientInstrument.perp.bidOrders.delete(perpMassCancelReport.orderId);
                                    clientInstrument.perp.funds += perpMassCancelReport.crncy;
                                }
                                else {
                                    const order = clientInstrument.spot.askOrders.
                                        get(perpMassCancelReport.orderId);
                                    if (order == null) {
                                        this.onError(report, "Order not found");
                                        break;
                                    }
                                    clientInstrument.perp.askOrders.delete(perpMassCancelReport.orderId);
                                    clientInstrument.perp.futures += perpMassCancelReport.perps;
                                }
                            }
                            break;
                        }
                        case LogType.perpChangeLeverage: {
                            const perpChangeLeverageReportModel = report as PerpChangeLeverageReportModel;
                            if (perpChangeLeverageReportModel.clientId == engine.originalClientId) {
                                const clientInstrument = this.instruments.
                                    get(perpChangeLeverageReportModel.instrId);
                                if (clientInstrument == null) {
                                    this.onError(report, "Instrument not found");
                                    break;
                                }
                                clientInstrument.perp.leverage = perpChangeLeverageReportModel.leverage;
                            }
                            break;
                        }
                        case LogType.perpFunding: {
                            const perpFundingReportModel = report as PerpFundingReportModel;
                            if (perpFundingReportModel.clientId == engine.originalClientId) {
                                const clientInstrument = this.instruments.
                                    get(perpFundingReportModel.instrId);
                                if (clientInstrument == null) {
                                    this.onError(report, "Instrument not found");
                                    break;
                                }
                                clientInstrument.perp.funds += perpFundingReportModel.funding;
                                clientInstrument.perp.funding += perpFundingReportModel.funding;
                            }
                            break;
                        }
                        case LogType.buyMarketSeat: {
                            const buyMarketSeatReportModel = report as BuyMarketSeatReportModel;
                            if (buyMarketSeatReportModel.clientId == engine.originalClientId) {
                                const clientInstrument = this.instruments.
                                    get(buyMarketSeatReportModel.instrId);
                                if (clientInstrument == null) {
                                    this.onError(report, "Instrument not found");
                                    break;
                                }
                                const sum = buyMarketSeatReportModel.seatPrice + buyMarketSeatReportModel.amount;
                                clientInstrument.perp.funds -= sum;
                                let token = this.tokens.get(clientInstrument.info.crncyTokenId);
                                if (token == null) {
                                    this.onError(report, "Currency token not found");
                                    break;
                                }
                                this.tokens.set(clientInstrument.info.crncyTokenId,
                                    token - sum);
                            }
                            break;
                        }
                        case LogType.sellMarketSeat: {
                            const sellMarketSeatReportModel = report as SellMarketSeatReportModel;
                            if (sellMarketSeatReportModel.clientId == engine.originalClientId) {
                                const clientInstrument = this.instruments.
                                    get(sellMarketSeatReportModel.instrId);
                                if (clientInstrument == null) {
                                    this.onError(report, "Instrument not found");
                                    break;
                                }
                                clientInstrument.perp.funds += sellMarketSeatReportModel.seatPrice;
                                let token = this.tokens.get(clientInstrument.info.crncyTokenId) ?? 0;
                                this.tokens.set(clientInstrument.info.crncyTokenId,
                                    token + sellMarketSeatReportModel.seatPrice);
                            }
                            break;
                        }
                    }
                }
            }
        }
    }
}

