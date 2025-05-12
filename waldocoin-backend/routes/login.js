router.get("/", async (req, res) => {
    try {
      const { default: XummSdk } = await import("xumm-sdk");
      console.log("✅ XummSdk loaded");
  
      const xumm = new XummSdk(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);
      console.log("🔐 XUMM initialized");
  
      const payload = {
        txjson: { TransactionType: "SignIn" }
      };
  
      const created = await xumm.payload.create(payload);
      console.log("✅ Payload created:", created);
  
      res.json({
        success: true,
        qr: created.refs.qr_png,
        uuid: created.uuid
      });
    } catch (err) {
      console.error("❌ XUMM QR error:", err.message);
      res.status(500).json({ success: false, error: "XUMM login failed." });
    }
  });
  