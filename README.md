# SubCore Solutions - Professional IT Services Website

A modern, production-ready business website for SubCore Solutions, an IT services company based in Albania. Features a complete e-commerce shop, multilingual support (Albanian/English), and a professional admin panel with enterprise-grade security.

## Features

### Public Website
- **Professional Design**: Modern, responsive UI optimized for mobile, tablet, and desktop
- **Multilingual Support**: Albanian (default) and English with language switcher on every page
- **Service Pages**: Comprehensive IT services showcase with professional pricing display
- **E-commerce Shop**: Full product catalog with cart and checkout functionality
- **Contact Forms**: Integrated contact forms with email and WhatsApp integration
- **Student Discounts**: Dedicated section for students with 20% discount information
- **Loading States**: Professional loading spinners and error handling
- **Empty States**: User-friendly messages when no products or data available

### Admin Panel
- **Secure Authentication**: Password hashing with bcrypt (pgcrypto), session expiration (30 min)
- **Dashboard**: Overview statistics (products, orders, revenue, services)
- **Product Management**: Add, edit, delete products with image upload and validation
- **Category Management**: Organize products into categories with multilingual support
- **Service Management**: Manage service offerings with pricing and display order
- **Order Management**: View and update order statuses (pending, processing, completed, cancelled)
- **Content Management**: Edit company information and homepage content
- **Settings**: Data backup/restore (JSON export/import)
- **Error Handling**: Comprehensive error messages for all operations

### Security Features
- **Password Hashing**: Uses PostgreSQL pgcrypto with bcrypt for secure password storage
- **Session Management**: Automatic session expiration after 30 minutes
- **Authentication Guards**: All admin operations require valid authentication
- **No Fallback Auth**: Removed insecure local authentication bypass
- **Input Validation**: Server-side validation for all operations
- **Row Level Security**: Supabase RLS policies enabled on all tables

### Technical Features
- **Supabase Backend**: Secure PostgreSQL database with pgcrypto extension
- **Responsive Design**: Mobile-first approach with professional aesthetics
- **Fast Loading**: Optimized for performance with lazy loading
- **SEO Friendly**: Proper meta tags and semantic HTML
- **Accessible**: ARIA labels and keyboard navigation support
- **Error States**: Professional loading spinners and error messages

## Technology Stack

- **Frontend**: Pure HTML, CSS, JavaScript (no frameworks)
- **Backend**: Supabase (PostgreSQL with pgcrypto extension)
- **Styling**: Custom CSS with CSS variables for theming
- **Icons**: SVG icons and emoji
- **Fonts**: DM Sans (Google Fonts)
- **Password Hashing**: PostgreSQL pgcrypto (bcrypt algorithm)

## Setup Instructions

### 1. Database Setup

1. Create a Supabase project at [supabase.com](https://supabase.com)
2. Go to the SQL Editor in your Supabase dashboard
3. Copy and run the SQL schema from `supabase-schema.sql`
4. This will create the following tables:
   - `categories` - Product categories
   - `products` - Shop products
   - `orders` - Customer orders
   - `admin_users` - Admin accounts with bcrypt password hashing
   - `services` - Service offerings
   - `website_settings` - Website content settings
5. The schema also creates:
   - pgcrypto extension for password hashing
   - `verify_admin_password` function for secure authentication
   - Row Level Security policies
   - Default admin user (password: subcore2026)

### 2. Configure Supabase Client

1. Get your Supabase URL and anon/public key from project settings
2. Update `supabase-client.js` with your credentials:

```javascript
const SUPABASE_URL = "your-supabase-url";
const SUPABASE_KEY = "your-supabase-anon-key";
```

**Security Note**: Never commit your Supabase credentials to public repositories. Use environment variables in production.

### 3. Default Admin Access

The default admin credentials are:
- **Email**: admin@subcoresolutions.online
- **Password**: subcore2026

**CRITICAL**: Change the default password immediately after first login. The password change feature requires backend implementation - contact your developer or implement a password update endpoint.

### 4. Deploy the Website

#### Option A: Static Hosting (GitHub Pages, Netlify, Vercel)

1. Upload all files to your hosting provider
2. Configure custom domain if needed
3. Set up environment variables for Supabase credentials
4. The site is ready to use

#### Option B: Traditional Web Hosting

1. Upload all files via FTP to your web server
2. Ensure `index.html` is set as the default document
3. Update Supabase credentials in `supabase-client.js`
4. The site is ready to use

#### Option C: Docker Deployment

```dockerfile
FROM nginx:alpine
COPY . /usr/share/nginx/html
EXPOSE 80
```

## Admin Panel Usage

### Accessing the Admin Panel

1. Navigate to `admin.html` on your website
2. Enter your admin email and password
3. Click "Sign In"
4. Sessions expire after 30 minutes of inactivity for security

### Dashboard Overview

The dashboard shows:
- **Total Products**: Number of active products
- **Total Orders**: Number of orders received
- **Total Revenue**: Sum of all order totals
- **Active Services**: Number of available services
- **Recent Orders**: Last 5 orders with quick status view

### Managing Products

1. Go to "Products" section
2. Click "+ Add Product" to create a new product
3. Fill in the product details:
   - Product ID (slug format, lowercase with hyphens)
   - Category selection
   - Name in English and Albanian
   - Description in English and Albanian
   - Price in USD
   - Stock quantity
   - Image URL or upload image (max 500KB)
   - Availability and featured status
4. Click "Save Product"
5. Data is automatically synced to Supabase

### Managing Categories

1. Go to "Categories" section
2. Enter category ID (slug format)
3. Enter category name in English and Albanian
4. Click "Add Category"
5. Cannot delete categories with existing products

### Managing Services

1. Go to "Services" section
2. Click "+ Add Service" to create a new service
3. Fill in service details:
   - Service ID (slug format)
   - Icon (emoji)
   - Display order (lower numbers appear first)
   - Price
   - Name and description in both languages
   - Availability and featured status
4. Click "Save Service"

### Managing Orders

1. Go to "Orders" section
2. View all orders with customer information
3. Click "View" to see order details in a modal
4. Change order status using the dropdown:
   - Pending
   - Processing
   - Completed
   - Cancelled
5. Status changes are immediately saved to database

### Managing Website Content

1. Go to "Content" section
2. **Company Information**: Update company name, tagline, emails, phone, WhatsApp
3. **Homepage Hero**: Update hero section titles and subtitles in both languages
4. Click "Save" to apply changes
5. Changes are immediately reflected on the website

### Settings

1. Go to "Settings" section
2. **Data Backup**:
   - Export JSON: Download all product data as JSON file
   - Import JSON: Restore product data from JSON file
3. **Password Change**: Requires backend implementation (currently disabled for security)

## Security Implementation

### Password Hashing

The system uses PostgreSQL's pgcrypto extension with bcrypt for secure password hashing:

```sql
-- Password is hashed using bcrypt with automatic salt generation
crypt('password', gen_salt('bf'))
```

### Session Management

- Sessions are stored in sessionStorage (cleared on browser close)
- Sessions expire after 30 minutes of inactivity
- Expired sessions automatically redirect to login
- No persistent authentication tokens stored

### Authentication Guards

All admin operations include authentication checks:

```javascript
function requireAuth() {
  if (!isAdminLoggedIn()) {
    adminLogout();
    window.location.reload();
    return false;
  }
  return true;
}
```

### Database Security

- Row Level Security (RLS) enabled on all tables
- Public read access for products, categories, services
- Admin-only access for management operations
- No plaintext password storage
- SQL injection protection through parameterized queries

## Language System

### Adding a New Language

1. Open `translations.js`
2. Add a new language object following the existing structure:

```javascript
const translations = {
  en: { /* existing */ },
  sq: { /* existing */ },
  de: { /* German translations */ }
};
```

3. Update `scripts.js` to handle the new language code
4. Add language button to the header in each HTML file

### Translation Structure

Each translation key follows the pattern: `section.element.property`

Example:
- `nav.home` - Navigation home link
- `hero.title` - Hero section title
- `pricing.webdev.price` - Web development pricing
- `shop.loading` - Loading state message
- `shop.errorTitle` - Error state title

## Customization

### Branding

1. Replace `logo.svg` and `logo-compact.svg` with your logos
2. Update company information in the admin panel Content section
3. Modify colors in `style.css` CSS variables:

```css
:root {
  --color-bg: #0a1920;
  --color-accent: #7eb8c9;
  --color-accent-bright: #9dd4e3;
  /* ... other colors */
}
```

### Adding New Pages

1. Create a new HTML file following the existing structure
2. Include the header with language switcher
3. Add translation keys to `translations.js`
4. Include necessary scripts at the bottom
5. Add loading and error states as needed

## Security Best Practices

### For Production Deployment

1. **Change Default Password**: Always change the default admin password immediately
2. **Use HTTPS**: Enable HTTPS for secure data transmission
3. **Environment Variables**: Store Supabase credentials in environment variables
4. **Regular Backups**: Use the export feature regularly to backup data
5. **Strong Passwords**: Use strong passwords for admin accounts (minimum 12 characters)
6. **Monitor Logs**: Check browser console and Supabase logs for errors
7. **Update Dependencies**: Keep Supabase client and dependencies updated
8. **Limit Admin Access**: Restrict admin panel access to trusted personnel only

### Known Security Limitations

1. **Password Change**: Currently requires backend implementation
2. **RLS Policies**: Admin policies are currently permissive (should be restricted to authenticated users)
3. **Rate Limiting**: No rate limiting on login attempts (implement at Supabase level)
4. **CSRF Protection**: No CSRF tokens (consider implementing for production)

## Performance Optimization

- Images are lazy-loaded with `loading="lazy"` attribute
- CSS uses hardware-accelerated transitions
- Minimal JavaScript dependencies
- Efficient database queries with Supabase
- Optimized font loading with Google Fonts
- Debounced search input (200ms delay)
- Async/await for non-blocking operations
- Promise.all for parallel API requests

## Browser Support

- Chrome/Edge (latest 2 versions)
- Firefox (latest 2 versions)
- Safari (latest 2 versions)
- Mobile browsers (iOS Safari 12+, Chrome Mobile)

## Troubleshooting

### Admin Panel Not Loading

1. Check browser console for errors
2. Verify Supabase credentials are correct
3. Ensure Supabase project is active
4. Check network tab for failed requests
5. Verify pgcrypto extension is enabled in Supabase

### Products Not Saving

1. Check browser console for error messages
2. Verify Supabase connection is working
3. Check if session has expired (login again)
4. Verify product ID is unique
5. Check Supabase logs for database errors

### Authentication Issues

1. Verify email and password are correct
2. Check if pgcrypto extension is enabled
3. Verify `verify_admin_password` function exists
4. Check Supabase logs for authentication errors
5. Ensure admin user exists in database

## Support

For issues or questions:
- Email: info@subcoresolutions.online
- WhatsApp: +355 68 666 1686

## License

© 2026 SubCore Solutions. All rights reserved.

---

**Built with professional security standards for production business use.**
