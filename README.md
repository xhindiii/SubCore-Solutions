# SubCore Solutions - Professional IT Services Website

A modern, production-ready business website for SubCore Solutions, an IT services company based in Albania. Features a complete e-commerce shop, multilingual support (Albanian/English), and a professional admin panel for content management.

## Features

### Public Website
- **Professional Design**: Modern, responsive UI optimized for mobile, tablet, and desktop
- **Multilingual Support**: Albanian (default) and English with language switcher on every page
- **Service Pages**: Comprehensive IT services showcase with professional pricing display
- **E-commerce Shop**: Full product catalog with cart and checkout functionality
- **Contact Forms**: Integrated contact forms with email and WhatsApp integration
- **Student Discounts**: Dedicated section for students with 20% discount information

### Admin Panel
- **Dashboard**: Overview statistics (products, orders, revenue, services)
- **Product Management**: Add, edit, delete products with image upload
- **Category Management**: Organize products into categories
- **Service Management**: Manage service offerings with pricing
- **Order Management**: View and update order statuses (pending, processing, completed, cancelled)
- **Content Management**: Edit company information and homepage content
- **Settings**: Change admin password and data backup/restore

### Technical Features
- **Supabase Backend**: Secure database with Row Level Security
- **Responsive Design**: Mobile-first approach with professional aesthetics
- **Fast Loading**: Optimized for performance
- **SEO Friendly**: Proper meta tags and semantic HTML
- **Accessible**: ARIA labels and keyboard navigation support

## Technology Stack

- **Frontend**: Pure HTML, CSS, JavaScript (no frameworks)
- **Backend**: Supabase (PostgreSQL database)
- **Styling**: Custom CSS with CSS variables for theming
- **Icons**: SVG icons and emoji
- **Fonts**: DM Sans (Google Fonts)

## Setup Instructions

### 1. Database Setup

1. Create a Supabase project at [supabase.com](https://supabase.com)
2. Go to the SQL Editor in your Supabase dashboard
3. Copy and run the SQL schema from `supabase-schema.sql`
4. This will create the following tables:
   - `categories` - Product categories
   - `products` - Shop products
   - `orders` - Customer orders
   - `admin_users` - Admin accounts
   - `services` - Service offerings
   - `website_settings` - Website content settings

### 2. Configure Supabase Client

1. Get your Supabase URL and anon/public key from project settings
2. Update `supabase-client.js` with your credentials:

```javascript
const SUPABASE_URL = "your-supabase-url";
const SUPABASE_KEY = "your-supabase-anon-key";
```

### 3. Default Admin Access

The default admin credentials are:
- **Email**: admin@subcoresolutions.online
- **Password**: subcore2026

**Important**: Change the default password immediately after first login via the admin panel Settings section.

### 4. Deploy the Website

#### Option A: Static Hosting (GitHub Pages, Netlify, Vercel)

1. Upload all files to your hosting provider
2. Configure custom domain if needed
3. The site is ready to use

#### Option B: Traditional Web Hosting

1. Upload all files via FTP to your web server
2. Ensure `index.html` is set as the default document
3. The site is ready to use

## Admin Panel Usage

### Accessing the Admin Panel

1. Navigate to `admin.html` on your website
2. Enter your admin email and password
3. Click "Sign In"

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
   - Product ID (slug format)
   - Category selection
   - Name in English and Albanian
   - Description in English and Albanian
   - Price in USD
   - Stock quantity
   - Image URL or upload image
   - Availability and featured status
4. Click "Save Product"

### Managing Categories

1. Go to "Categories" section
2. Enter category ID (slug format)
3. Enter category name in English and Albanian
4. Click "Add Category"

### Managing Services

1. Go to "Services" section
2. Click "+ Add Service" to create a new service
3. Fill in service details:
   - Service ID (slug format)
   - Icon (emoji)
   - Display order
   - Price
   - Name and description in both languages
   - Availability and featured status
4. Click "Save Service"

### Managing Orders

1. Go to "Orders" section
2. View all orders with customer information
3. Click "View" to see order details
4. Change order status using the dropdown:
   - Pending
   - Processing
   - Completed
   - Cancelled

### Managing Website Content

1. Go to "Content" section
2. **Company Information**: Update company name, tagline, emails, phone, WhatsApp
3. **Homepage Hero**: Update hero section titles and subtitles in both languages
4. Click "Save" to apply changes

### Settings

1. Go to "Settings" section
2. **Change Password**: Update your admin password (minimum 6 characters)
3. **Data Backup**:
   - Export JSON: Download all product data as JSON file
   - Import JSON: Restore product data from JSON file

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

## Customization

### Branding

1. Replace `logo.svg` and `logo-compact.svg` with your logos
2. Update company information in the admin panel or database
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

## Security Considerations

1. **Change Default Password**: Always change the default admin password
2. **Supabase RLS**: Row Level Security is enabled on all tables
3. **HTTPS**: Use HTTPS in production for secure data transmission
4. **Regular Backups**: Use the export feature regularly to backup data
5. **Strong Passwords**: Use strong passwords for admin accounts

## Performance Optimization

- Images are lazy-loaded
- CSS uses hardware-accelerated transitions
- Minimal JavaScript dependencies
- Efficient database queries with Supabase
- Optimized font loading with Google Fonts

## Browser Support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers (iOS Safari, Chrome Mobile)

## Support

For issues or questions:
- Email: info@subcoresolutions.online
- WhatsApp: +355 68 666 1686

## License

© 2026 SubCore Solutions. All rights reserved.

---

**Built with professional standards for business use.**
