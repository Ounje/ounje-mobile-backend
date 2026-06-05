const ResendProvider = require("../services/email/ResendProvider");
const logger = require("../utils/logger");

const provider = new ResendProvider();

const OPS_EMAIL = process.env.OPS_EMAIL;

const send = (subject, html) => {
  if (!OPS_EMAIL) return;
  provider.sendEmail(OPS_EMAIL, subject, html).catch((e) =>
    logger.error(`[OpsAlert] Failed to send email: ${e.message}`)
  );
};

const wrap = (title, color, rows) => `
  <div style="font-family:sans-serif;max-width:560px;margin:0 auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
    <div style="background:${color};padding:18px 24px">
      <h2 style="margin:0;color:#fff;font-size:17px">${title}</h2>
    </div>
    <table style="width:100%;border-collapse:collapse">
      ${rows.map(([k, v]) => `
        <tr>
          <td style="padding:10px 24px;font-size:13px;color:#6b7280;width:38%;border-bottom:1px solid #f3f4f6">${k}</td>
          <td style="padding:10px 24px;font-size:13px;color:#111827;border-bottom:1px solid #f3f4f6"><strong>${v ?? "—"}</strong></td>
        </tr>`).join("")}
    </table>
    <div style="padding:14px 24px;font-size:11px;color:#9ca3af;background:#f9fafb">
      Ounje Food · auto-generated operational alert
    </div>
  </div>`;

const fmt = (n) => `₦${Number(n ?? 0).toLocaleString("en-NG")}`;
const fmtDate = () => new Date().toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });

module.exports = {
  newOrder(order, vendorName, customerName) {
    send(
      `🆕 New Order — ${order.orderNumber ?? order._id}`,
      wrap("New Order Received", "#1a3f1c", [
        ["Order #",    order.orderNumber ?? String(order._id)],
        ["Customer",   customerName ?? "Unknown"],
        ["Vendor",     vendorName    ?? "Unknown"],
        ["Total",      fmt(order.totalPrice)],
        ["Payment",    order.paymentMethod ?? "—"],
        ["Time",       fmtDate()],
      ])
    );
  },

  paymentFailed(reference, amountNaira, customerEmail) {
    send(
      `💳 Payment Failed — ${reference}`,
      wrap("Payment Failed", "#b45309", [
        ["Reference",      reference ?? "—"],
        ["Amount",         fmt(amountNaira)],
        ["Customer Email", customerEmail ?? "—"],
        ["Time",           fmtDate()],
      ])
    );
  },

  newVendorRegistered(name, phone, location) {
    send(
      `🏪 New Vendor Registered — ${name}`,
      wrap("New Vendor Registration", "#1d4ed8", [
        ["Name",     name     ?? "—"],
        ["Phone",    phone    ?? "—"],
        ["Location", location ?? "—"],
        ["Time",     fmtDate()],
      ])
    );
  },

  newRiderRegistered(name, phone) {
    send(
      `🏍️ New Rider Registered — ${name}`,
      wrap("New Rider Registration", "#7c3aed", [
        ["Name",  name  ?? "—"],
        ["Phone", phone ?? "—"],
        ["Time",  fmtDate()],
      ])
    );
  },

  refundInitiated(orderNumber, amountNaira, reason) {
    send(
      `💰 Refund Initiated — ${orderNumber}`,
      wrap("Refund Initiated", "#0369a1", [
        ["Order #", orderNumber ?? "—"],
        ["Amount",  fmt(amountNaira)],
        ["Reason",  reason  ?? "—"],
        ["Time",    fmtDate()],
      ])
    );
  },
};
