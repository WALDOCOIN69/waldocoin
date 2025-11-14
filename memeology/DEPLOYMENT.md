# 🚀 Memeology Deployment Guide

Complete guide to deploy Memeology to Hostinger (memeology.fun)

---

## 📋 **PRE-DEPLOYMENT CHECKLIST**

### **1. Get XUMM API Keys** (Optional but Recommended)
- Go to https://apps.xumm.dev/
- Create a new app
- Copy API Key and API Secret
- Add to backend `.env` file

### **2. Verify Domain Setup**
- ✅ Domain: `memeology.fun` purchased
- ✅ DNS pointing to Hostinger server
- ✅ SSL certificate configured

### **3. Backend Integration**
- Option A: Use existing waldocoin-backend (RECOMMENDED)
- Option B: Deploy separate memeology backend

---

## 🏗️ **DEPLOYMENT STEPS**

### **Step 1: Build Frontend**

```bash
cd memeology

# Install dependencies (if not already done)
npm install

# Build for production
npm run build
```

This creates a `dist/` folder with optimized production files.

---

### **Step 2: Configure Environment Variables**

**Frontend (.env.production):**
```bash
VITE_API_URL=https://waldocoin.live
VITE_WALDOCOIN_URL=https://waldocoin.live
```

**Backend (backend/.env):**
```bash
IMGFLIP_USERNAME=waldolabs
IMGFLIP_PASSWORD=waldolabs123
XRPL_SERVER=https://s1.ripple.com:51234
WLO_ISSUER=rN7n7otQDd6FczFgLdlqtyMVrn3NnrcVcU
XUMM_API_KEY=your_actual_key
XUMM_API_SECRET=your_actual_secret
```

---

### **Step 3: Upload to Hostinger**

#### **Option A: Using File Manager**
1. Login to Hostinger control panel
2. Go to **File Manager**
3. Navigate to `public_html/`
4. Create folder: `memeology.fun/` (or use domain root)
5. Upload entire `dist/` folder contents
6. Set permissions: 755 for folders, 644 for files

#### **Option B: Using FTP**
```bash
# Using FileZilla or similar FTP client
Host: ftp.memeology.fun
Username: your_hostinger_username
Password: your_hostinger_password
Port: 21

# Upload dist/ contents to:
/public_html/memeology.fun/
```

#### **Option C: Using SSH** (if available)
```bash
ssh your_username@your_server_ip

cd public_html/memeology.fun/
# Upload files using scp or rsync
```

---

### **Step 4: Configure Backend**

#### **If using waldocoin-backend:**

Add memeology endpoints to existing waldocoin-backend:

1. Copy `memeology/backend/main.py` endpoints to waldocoin-backend
2. Update CORS to include `memeology.fun`:
   ```python
   allow_origins=["https://waldocoin.live", "https://memeology.fun"]
   ```
3. Install dependencies:
   ```bash
   pip install xrpl-py==2.5.0
   ```
4. Restart backend server

#### **If deploying separate backend:**

1. Upload `backend/` folder to server
2. Install Python dependencies:
   ```bash
   cd backend
   pip install -r requirements.txt
   ```
3. Run with systemd or supervisor:
   ```bash
   uvicorn main:app --host 0.0.0.0 --port 8000
   ```

---

### **Step 5: Configure .htaccess** (for React Router)

Create `.htaccess` in the root of your upload folder:

```apache
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  RewriteRule ^index\.html$ - [L]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteCond %{REQUEST_FILENAME} !-l
  RewriteRule . /index.html [L]
</IfModule>
```

This ensures React Router works correctly with direct URL access.

---

## ✅ **POST-DEPLOYMENT VERIFICATION**

### **1. Test Frontend**
- Visit https://memeology.fun
- Check if page loads correctly
- Verify logo, branding, and styling

### **2. Test XUMM Login**
- Click "🔐 Login with XUMM"
- Verify QR code appears
- Test login flow with XUMM app

### **3. Test Tier Detection**
- Login with wallet that has 1000+ WLO
- Verify tier shows as "🪙 WALDOCOIN"
- Check template count (should be 150)

### **4. Test Meme Creation**
- Select a template
- Add text
- Drag text to reposition
- Download meme
- Verify image downloads correctly

### **5. Test NFT Integration** (WALDOCOIN/Premium tier)
- Click "🖼️ Use My NFTs"
- Verify NFTs load from wallet
- Click NFT to use as template
- Create and download meme

---

## 🔧 **TROUBLESHOOTING**

### **Issue: Blank page after deployment**
- Check browser console for errors
- Verify `base` path in `vite.config.js`
- Check `.htaccess` is configured correctly

### **Issue: API calls failing**
- Verify `VITE_API_URL` in `.env.production`
- Check CORS settings in backend
- Verify backend is running

### **Issue: XUMM login not working**
- Check XUMM API keys are correct
- Verify backend `/api/auth/xumm/login` endpoint
- Check browser console for errors

### **Issue: Tier not detecting correctly**
- Verify WLO issuer address is correct
- Check XRPL connection in backend
- Test `/api/wallet/balance` endpoint manually

---

## 📊 **MONITORING**

### **Check Backend Logs**
```bash
# If using systemd
journalctl -u memeology-backend -f

# If using PM2
pm2 logs memeology-backend
```

### **Check Frontend Access Logs**
```bash
# In Hostinger File Manager
tail -f /var/log/apache2/access.log
```

---

## 🔄 **UPDATING THE SITE**

When you make changes:

```bash
# 1. Make changes to code
# 2. Rebuild frontend
npm run build

# 3. Upload new dist/ contents to Hostinger
# (overwrites old files)

# 4. Clear browser cache and test
```

---

## 🎯 **PRODUCTION CHECKLIST**

- [ ] Frontend built with `npm run build`
- [ ] `.env.production` configured with production URLs
- [ ] `dist/` folder uploaded to Hostinger
- [ ] `.htaccess` configured for React Router
- [ ] Backend endpoints added to waldocoin-backend
- [ ] CORS configured for memeology.fun
- [ ] XUMM API keys configured (optional)
- [ ] SSL certificate active
- [ ] DNS pointing correctly
- [ ] All features tested in production
- [ ] Error monitoring set up

---

## 🚀 **LAUNCH!**

Once all checks pass:
1. Announce on WALDOCOIN social media
2. Share link: https://memeology.fun
3. Monitor for issues
4. Collect user feedback
5. Iterate and improve!

---

**Need help?** Check waldocoin.live deployment for reference patterns.

