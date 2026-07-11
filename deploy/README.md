# 🚀 Deploy POS Barokah — Panduan Cepat

## Domain
| Komponen | URL |
|----------|-----|
| 🖥️ Admin Panel | https://posbarokah.barokahgroupindonesia.tech |
| ⚙️ Backend API | https://backend.posbarokah.barokahgroupindonesia.tech |
| 📖 API Docs | https://backend.posbarokah.barokahgroupindonesia.tech/api/docs |

---

## Prasyarat di Server
```bash
# Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Tools lainnya
sudo apt install -y nginx git certbot python3-certbot-nginx
npm install -g pm2
```

---

## DNS (di panel domain barokahgroupindonesia.tech)
```
posbarokah             A    187.77.122.142
backend.posbarokah     A    187.77.122.142
```
> Tunggu DNS propagasi (~5–30 menit) sebelum request SSL.

---

## Deploy (satu perintah)
```bash
# 1. Clone repo
git clone https://github.com/zyoonline85-ctrl/posbarokah.git /var/www/posbarokah

# 2. Isi .env Backend
cp /var/www/posbarokah/"SC POS-BACKEND-BAROKAH"/.env.production.template \
   /var/www/posbarokah/"SC POS-BACKEND-BAROKAH"/.env
nano /var/www/posbarokah/"SC POS-BACKEND-BAROKAH"/.env

# 3. Isi .env Admin
cp /var/www/posbarokah/"SC POS-ADMIN-BAROKAH"/.env.production.template \
   /var/www/posbarokah/"SC POS-ADMIN-BAROKAH"/.env
nano /var/www/posbarokah/"SC POS-ADMIN-BAROKAH"/.env

# 4. Jalankan script deploy otomatis
chmod +x /var/www/posbarokah/deploy/deploy.sh
sudo bash /var/www/posbarokah/deploy/deploy.sh
```

---

## Update Kode (setelah deploy pertama)
```bash
cd /var/www/posbarokah

# Pull update terbaru
git pull origin main

# Update Backend
cp -r "SC POS-BACKEND-BAROKAH/." backend/
cd backend && npm install --omit=dev && npm run migrate
pm2 restart pos-backend-barokah

# Update Admin
cp -r "SC POS-ADMIN-BAROKAH/." admin/
cd admin && npm install && npm run build
sudo systemctl reload nginx
```

---

## Perintah Berguna
```bash
pm2 status                          # Status semua proses
pm2 logs pos-backend-barokah        # Log backend live
pm2 restart pos-backend-barokah     # Restart backend
sudo nginx -t                       # Test config Nginx
sudo systemctl reload nginx         # Reload Nginx
sudo certbot renew --dry-run        # Test renew SSL
```

---

## File Nginx (di server)
```
/etc/nginx/sites-available/posbarokah-admin     ← Admin Panel
/etc/nginx/sites-available/posbarokah-backend   ← Backend API
/etc/nginx/sites-enabled/posbarokah-admin       ← symlink
/etc/nginx/sites-enabled/posbarokah-backend     ← symlink
```

> ⚠️ Konfigurasi ini **tidak akan mengganggu** vhost Nginx lain yang sudah berjalan di server.
