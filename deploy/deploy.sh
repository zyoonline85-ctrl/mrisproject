#!/bin/bash
# ============================================================
# deploy.sh — Script Deploy POS Barokah ke Server Production
# Server  : 187.77.122.142
# Domain  : barokahgroupindonesia.tech
#
# CARA PAKAI (di server via SSH):
#   chmod +x deploy/deploy.sh
#   sudo bash deploy/deploy.sh
#
# Script ini TIDAK akan mengganggu proyek lain di server.
# Setiap konfigurasi Nginx disimpan dalam file terpisah.
# ============================================================

set -e  # Stop jika ada error

# ── Load NVM jika terpasang (untuk non-interactive shell) ──────
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
    . "$NVM_DIR/nvm.sh"
elif [ -s "/root/.nvm/nvm.sh" ]; then
    export NVM_DIR="/root/.nvm"
    . "$NVM_DIR/nvm.sh"
fi


# ── Warna terminal ────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC}  $1"; }
success() { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }
step()    { echo -e "\n${CYAN}━━━ $1 ━━━${NC}"; }

# ── Variabel ──────────────────────────────────────────────────
REPO_URL="https://github.com/zyoonline85-ctrl/posbarokah.git"
BASE_DIR="/var/www/mris-project"
BACKEND_DIR="$BASE_DIR/backend"
ADMIN_DIR="$BASE_DIR/admin"
LOG_DIR="/var/log/pm2"

DOMAIN_ADMIN="posbarokah.barokahgroupindonesia.tech"
DOMAIN_BACKEND="backend.posbarokah.barokahgroupindonesia.tech"

NGINX_AVAILABLE="/etc/nginx/sites-available"
NGINX_ENABLED="/etc/nginx/sites-enabled"

# ════════════════════════════════════════════════════════════
step "1. Cek prasyarat"
# ════════════════════════════════════════════════════════════

command -v node  >/dev/null 2>&1 || error "Node.js tidak terinstall. Jalankan: curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash - && sudo apt install -y nodejs"
command -v npm   >/dev/null 2>&1 || error "npm tidak ditemukan."
command -v pm2   >/dev/null 2>&1 || { warn "PM2 belum ada, install..."; npm install -g pm2; }
command -v nginx >/dev/null 2>&1 || error "Nginx tidak terinstall. Jalankan: sudo apt install -y nginx"
command -v git   >/dev/null 2>&1 || error "Git tidak terinstall."
command -v certbot >/dev/null 2>&1 || warn "Certbot belum terinstall. SSL akan dilewati. Install: sudo apt install -y certbot python3-certbot-nginx"

success "Semua prasyarat terpenuhi"

# ════════════════════════════════════════════════════════════
step "2. Clone / update repository"
# ════════════════════════════════════════════════════════════

mkdir -p "$BASE_DIR"

if [ -d "$BASE_DIR/.git" ]; then
    info "Repo sudah ada, pull update..."
    cd "$BASE_DIR" && git pull origin main
else
    info "Clone repo dari GitHub..."
    git clone "$REPO_URL" "$BASE_DIR"
    cd "$BASE_DIR"
fi

success "Repository siap"

# ════════════════════════════════════════════════════════════
step "3. Setup Backend (Node.js)"
# ════════════════════════════════════════════════════════════

# Salin source backend ke working dir
mkdir -p "$BACKEND_DIR"
cp -r "$BASE_DIR/SC POS-BACKEND-BAROKAH/." "$BACKEND_DIR/"

cd "$BACKEND_DIR"

# Cek .env
if [ ! -f ".env" ]; then
    warn ".env tidak ditemukan!"
    info "Menyalin dari template..."
    cp .env.production.template .env
    echo ""
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${RED}  WAJIB: Edit file .env sebelum melanjutkan!${NC}"
    echo -e "${RED}  Jalankan: nano $BACKEND_DIR/.env${NC}"
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    read -p "Tekan ENTER setelah selesai edit .env..."
fi

info "Install dependencies backend..."
npm install --omit=dev

info "Jalankan migrasi database..."
npm run migrate || warn "Migrasi gagal atau sudah up-to-date"

# Update path di ecosystem.config.cjs
sed -i "s|/var/www/mris-project/backend|$BACKEND_DIR|g" "$BASE_DIR/deploy/ecosystem.config.cjs"

mkdir -p "$LOG_DIR"

info "Start / restart backend via PM2..."
pm2 describe mris-project-backend > /dev/null 2>&1 \
    && pm2 restart mris-project-backend \
    || pm2 start "$BASE_DIR/deploy/ecosystem.config.cjs" --env production

pm2 save
success "Backend berjalan di port 4000"

# ════════════════════════════════════════════════════════════
step "4. Build Admin Panel (React)"
# ════════════════════════════════════════════════════════════

mkdir -p "$ADMIN_DIR"
cp -r "$BASE_DIR/SC POS-ADMIN-BAROKAH/." "$ADMIN_DIR/"

cd "$ADMIN_DIR"

# Cek .env
if [ ! -f ".env" ]; then
    warn ".env Admin tidak ditemukan!"
    info "Menyalin dari template..."
    cp .env.production.template .env
    echo ""
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${RED}  WAJIB: Edit file .env Admin sebelum melanjutkan!${NC}"
    echo -e "${RED}  Jalankan: nano $ADMIN_DIR/.env${NC}"
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    read -p "Tekan ENTER setelah selesai edit .env..."
fi

info "Install dependencies admin..."
npm install

info "Build React untuk production..."
npm run build

success "Admin build selesai → $ADMIN_DIR/dist"

# ════════════════════════════════════════════════════════════
step "5. Setup Nginx"
# ════════════════════════════════════════════════════════════

info "Salin konfigurasi Nginx..."

# Admin
cp "$BASE_DIR/deploy/nginx/posbarokah-admin"   "$NGINX_AVAILABLE/posbarokah-admin"
# Backend
cp "$BASE_DIR/deploy/nginx/posbarokah-backend" "$NGINX_AVAILABLE/posbarokah-backend"

# Update path dist di config Admin
sed -i "s|/var/www/posbarokah/admin/dist|$ADMIN_DIR/dist|g" "$NGINX_AVAILABLE/posbarokah-admin"

# Symlink aktifkan (tidak akan error jika sudah ada)
ln -sf "$NGINX_AVAILABLE/posbarokah-admin"   "$NGINX_ENABLED/posbarokah-admin"
ln -sf "$NGINX_AVAILABLE/posbarokah-backend" "$NGINX_ENABLED/posbarokah-backend"

# Test konfigurasi Nginx
info "Test konfigurasi Nginx..."
nginx -t || error "Nginx config error! Cek file konfigurasi."

info "Reload Nginx..."
systemctl reload nginx

success "Nginx aktif dengan konfigurasi baru"

# ════════════════════════════════════════════════════════════
step "6. Setup SSL (Let's Encrypt)"
# ════════════════════════════════════════════════════════════

if command -v certbot &> /dev/null; then
    info "Minta sertifikat SSL untuk kedua subdomain..."
    certbot --nginx \
        -d "$DOMAIN_ADMIN" \
        -d "$DOMAIN_BACKEND" \
        --non-interactive \
        --agree-tos \
        --email admin@barokahgroupindonesia.tech \
        --redirect \
        || warn "Certbot gagal. Pastikan DNS sudah mengarah ke server ini."

    info "Reload Nginx setelah SSL..."
    systemctl reload nginx
    success "SSL aktif"
else
    warn "Certbot tidak ditemukan. SSL dilewati."
    warn "Install: sudo apt install -y certbot python3-certbot-nginx"
fi

# ════════════════════════════════════════════════════════════
step "7. PM2 startup (auto-start saat server reboot)"
# ════════════════════════════════════════════════════════════

pm2 startup systemd -u root --hp /root || true
pm2 save

# ════════════════════════════════════════════════════════════
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║         DEPLOY POS BAROKAH SELESAI! 🎉          ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║                                                  ║${NC}"
echo -e "${GREEN}║  🖥️  Admin : https://$DOMAIN_ADMIN ${NC}"
echo -e "${GREEN}║  ⚙️  API   : https://$DOMAIN_BACKEND ${NC}"
echo -e "${GREEN}║  📖  Docs  : https://$DOMAIN_BACKEND/api/docs ${NC}"
echo -e "${GREEN}║                                                  ║${NC}"
echo -e "${GREEN}║  PM2 status: pm2 status                          ║${NC}"
echo -e "${GREEN}║  PM2 log  : pm2 logs mris-project-backend         ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
