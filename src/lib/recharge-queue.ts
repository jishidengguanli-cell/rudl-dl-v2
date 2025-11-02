import type { D1Database } from '@cloudflare/workers-types';
import { applyRecharge } from './recharge';
import { markEcpayOrderPaid, markEcpayOrderFailed } from './ecpay';
import { RechargeError } from './recharge';

type BaseMarkPayload = {
  rtnCode: string;
  rtnMsg: string;
  paymentType?: string;
  paymentMethod?: string;
  tradeNo?: string | null;
  tradeAmt?: string | number | null;
  paymentDate?: string | null;
  raw: Record<string, string>;
};

type QueueTask = {
  merchantTradeNo: string;
  accountId: string;
  points: number;
  payload: BaseMarkPayload;
  DB: D1Database;
  attempts: number;
};

const pendingTasks = new Map<string, boolean>();

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const getDelay = (attempt: number) => Math.min(200 * 2 ** attempt, 5_000);
const MAX_ATTEMPTS = 6;

const processTask = async (task: QueueTask) => {
  try {
    const recharge = await applyRecharge(task.DB, task.accountId, task.points, `ecpay:${task.merchantTradeNo}`);
    const normalizedPayload = {
      ...task.payload,
      tradeNo: task.payload.tradeNo ?? undefined,
      tradeAmt: task.payload.tradeAmt ?? undefined,
      paymentDate: task.payload.paymentDate ?? undefined,
      ledgerId: recharge.ledgerId,
      balanceAfter: recharge.balance,
    };
    await markEcpayOrderPaid(task.DB, task.merchantTradeNo, normalizedPayload, 'orderResult');
    console.info('[recharge-queue] task completed', { merchantTradeNo: task.merchantTradeNo });
    pendingTasks.delete(task.merchantTradeNo);
  } catch (error) {
    task.attempts += 1;
    if (error instanceof RechargeError && error.status === 404) {
      console.error('[recharge-queue] account missing, marking failed', {
        merchantTradeNo: task.merchantTradeNo,
        message: error.message,
      });
      await markEcpayOrderFailed(task.DB, task.merchantTradeNo, { rtnCode: task.payload.rtnCode, rtnMsg: error.message, raw: task.payload.raw }, 'orderResult');
      pendingTasks.delete(task.merchantTradeNo);
      return;
    }

    if (task.attempts >= MAX_ATTEMPTS) {
      console.error('[recharge-queue] exhausted retries', {
        merchantTradeNo: task.merchantTradeNo,
        attempts: task.attempts,
        error: error instanceof Error ? error.message : String(error),
      });
      pendingTasks.delete(task.merchantTradeNo);
      throw error;
    }

    const delay = getDelay(task.attempts);
    console.warn('[recharge-queue] retrying', {
      merchantTradeNo: task.merchantTradeNo,
      attempts: task.attempts,
      delay,
      error: error instanceof Error ? error.message : String(error),
    });
    await wait(delay);
    await processTask(task);
  }
};

export const enqueueRechargeTask = async (
  DB: D1Database,
  merchantTradeNo: string,
  accountId: string,
  points: number,
  payload: BaseMarkPayload
) => {
  if (pendingTasks.get(merchantTradeNo)) return;
  pendingTasks.set(merchantTradeNo, true);
  console.info('[recharge-queue] task enqueued', { merchantTradeNo });
  try {
    await processTask({ merchantTradeNo, accountId, points, payload, DB, attempts: 0 });
  } finally {
    pendingTasks.delete(merchantTradeNo);
  }
};
