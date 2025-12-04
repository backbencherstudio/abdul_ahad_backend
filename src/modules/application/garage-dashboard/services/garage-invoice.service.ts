import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { SojebStorage } from 'src/common/lib/Disk/SojebStorage';
import appConfig from 'src/config/app.config';
import puppeteer from 'puppeteer';
import { format } from 'date-fns';

@Injectable()
export class GarageInvoiceService {
  private readonly logger = new Logger(GarageInvoiceService.name);

  constructor(private prisma: PrismaService) {}

  async getInvoices(
    userId: string,
    page: number = 1,
    limit: number = 10,
    status?: string,
  ) {
    try {
      const skip = (page - 1) * limit;

      const where: any = {
        garage_id: userId,
      };

      if (status) {
        where.status = status;
      }

      const [invoices, total] = await Promise.all([
        this.prisma.invoice.findMany({
          where,
          skip,
          take: limit,
          orderBy: {
            created_at: 'desc',
          },
          include: {
            driver: {
              select: {
                id: true,
                name: true,
                email: true,
                phone_number: true,
                address: true,
                city: true,
                state: true,
                zip_code: true,
              },
            },
            order: {
              include: {
                vehicle: {
                  select: {
                    registration_number: true,
                    make: true,
                    model: true,
                  },
                },
                items: {
                  include: {
                    service: {
                      select: {
                        name: true,
                        type: true,
                        price: true,
                      },
                    },
                  },
                },
              },
            },
          },
        }),
        this.prisma.invoice.count({ where }),
      ]);

      // Format invoices with PDF URL if exists
      const formattedInvoices = invoices.map((invoice) => {
        const invoiceData: any = {
          id: invoice.id,
          invoice_number: invoice.invoice_number,
          driver: invoice.driver,
          order: invoice.order,
          membership_period: invoice.membership_period,
          issue_date: invoice.issue_date,
          due_date: invoice.due_date,
          amount: invoice.amount.toString(),
          status: invoice.status,
          created_at: invoice.created_at,
          updated_at: invoice.updated_at,
        };

        // Add PDF URL if exists
        if (invoice.pdf_url) {
          invoiceData.pdf_url = SojebStorage.url(
            appConfig().storageUrl.package + invoice.pdf_url,
          );
        }

        return invoiceData;
      });

    return {
      success: true,
      message: 'Invoices retrieved successfully',
        data: formattedInvoices,
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error(`Error fetching invoices: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getInvoice(userId: string, invoiceId: string) {
    try {
      const invoice = await this.prisma.invoice.findFirst({
        where: {
          id: invoiceId,
          garage_id: userId,
        },
        include: {
          garage: {
            select: {
              id: true,
              garage_name: true,
              email: true,
              phone_number: true,
              address: true,
              city: true,
              state: true,
              zip_code: true,
              vts_number: true,
            },
          },
          driver: {
            select: {
              id: true,
              name: true,
              email: true,
              phone_number: true,
              address: true,
              city: true,
              state: true,
              zip_code: true,
            },
          },
          order: {
            include: {
              vehicle: {
                select: {
                  registration_number: true,
                  make: true,
                  model: true,
                  color: true,
                  year_of_manufacture: true,
                },
              },
              items: {
                include: {
                  service: {
                    select: {
                      name: true,
                      type: true,
                      price: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!invoice) {
        throw new NotFoundException('Invoice not found');
      }

      const invoiceData: any = {
        id: invoice.id,
        invoice_number: invoice.invoice_number,
        garage: invoice.garage,
        driver: invoice.driver,
        order: invoice.order,
        membership_period: invoice.membership_period,
        issue_date: invoice.issue_date,
        due_date: invoice.due_date,
        amount: invoice.amount.toString(),
        status: invoice.status,
        created_at: invoice.created_at,
        updated_at: invoice.updated_at,
      };

      // Add PDF URL if exists
      if (invoice.pdf_url) {
        invoiceData.pdf_url = SojebStorage.url(
          appConfig().storageUrl.package + invoice.pdf_url,
        );
      }

    return {
      success: true,
      message: 'Invoice retrieved successfully',
        data: invoiceData,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Error fetching invoice: ${error.message}`, error.stack);
      throw error;
    }
  }

  async downloadInvoice(userId: string, invoiceId: string) {
    try {
      // Fetch invoice with all related data
      const invoice = await this.prisma.invoice.findFirst({
        where: {
          id: invoiceId,
          garage_id: userId,
        },
        include: {
          garage: {
            select: {
              id: true,
              garage_name: true,
              email: true,
              phone_number: true,
              address: true,
              city: true,
              state: true,
              zip_code: true,
              vts_number: true,
            },
          },
          driver: {
            select: {
              id: true,
              name: true,
              email: true,
              phone_number: true,
              address: true,
              city: true,
              state: true,
              zip_code: true,
            },
          },
          order: {
            include: {
              vehicle: {
                select: {
                  registration_number: true,
                  make: true,
                  model: true,
                  color: true,
                  year_of_manufacture: true,
                },
              },
              items: {
                include: {
                  service: {
                    select: {
                      name: true,
                      type: true,
                      price: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!invoice) {
        throw new NotFoundException('Invoice not found');
      }

      // Check if PDF already exists
      if (invoice.pdf_url) {
        const pdfUrl = SojebStorage.url(
          appConfig().storageUrl.package + invoice.pdf_url,
        );
        return {
          success: true,
          message: 'Invoice PDF retrieved successfully',
          data: {
            pdf_url: pdfUrl,
            invoice_id: invoice.id,
            invoice_number: invoice.invoice_number,
          },
        };
      }

      // Generate PDF
      const pdfBuffer = await this.generateInvoicePDF(invoice);

      // Save PDF to storage
      const fileName = `invoice-${invoice.invoice_number}-${Date.now()}.pdf`;
      const storagePath = `invoices/${fileName}`;
      await SojebStorage.put(
        appConfig().storageUrl.package + storagePath,
        pdfBuffer,
      );

      // Update invoice with PDF URL
      await this.prisma.invoice.update({
        where: { id: invoiceId },
        data: { pdf_url: storagePath },
      });

      const pdfUrl = SojebStorage.url(
        appConfig().storageUrl.package + storagePath,
      );

      return {
        success: true,
        message: 'Invoice PDF generated successfully',
        data: {
          pdf_url: pdfUrl,
          invoice_id: invoice.id,
          invoice_number: invoice.invoice_number,
        },
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(
        `Error generating invoice PDF: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(
        `Failed to generate invoice PDF: ${error.message}`,
      );
    }
  }

  private async generateInvoicePDF(invoice: any): Promise<Buffer> {
    let browser;
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      const page = await browser.newPage();

      // Generate HTML content for invoice
      const htmlContent = this.generateInvoiceHTML(invoice);

      await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

      // Generate PDF
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '20mm',
          right: '15mm',
          bottom: '20mm',
          left: '15mm',
        },
      });

      return pdfBuffer;
    } catch (error) {
      this.logger.error(`Error generating PDF: ${error.message}`, error.stack);
      throw error;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  private generateInvoiceHTML(invoice: any): string {
    const formatDate = (date: Date | null) => {
      if (!date) return 'N/A';
      return format(new Date(date), 'dd MMM yyyy');
    };

    const formatCurrency = (amount: string | number) => {
      const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
      return `£${numAmount.toFixed(2)}`;
    };

    const garage = invoice.garage;
    const driver = invoice.driver;
    const order = invoice.order;

    // Calculate amounts - assuming invoice.amount is the total including VAT
    const total = parseFloat(invoice.amount.toString());
    const vatRate = 0.2; // 20% VAT
    const subtotal = total / (1 + vatRate); // Calculate subtotal from total
    const vat = total - subtotal;

    // Build order items HTML if order exists
    let orderItemsHTML = '';
    if (order && order.items && order.items.length > 0) {
      orderItemsHTML = order.items
        .map(
          (item: any) => `
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #eee;">${item.service.name}</td>
          <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity}</td>
          <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">${formatCurrency(item.price)}</td>
          <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">${formatCurrency(parseFloat(item.price.toString()) * item.quantity)}</td>
        </tr>
      `,
        )
        .join('');
    } else {
      // If no order items, show membership period
      orderItemsHTML = `
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #eee;" colspan="4">${invoice.membership_period || 'Subscription/Membership'}</td>
        </tr>
      `;
    }

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: Arial, sans-serif;
      font-size: 12px;
      color: #333;
      line-height: 1.6;
      margin: 0;
      padding: 0;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 30px;
      border-bottom: 2px solid #333;
      padding-bottom: 20px;
    }
    .logo-section {
      flex: 1;
    }
    .invoice-info {
      text-align: right;
    }
    .invoice-title {
      font-size: 24px;
      font-weight: bold;
      margin-bottom: 10px;
    }
    .invoice-number {
      font-size: 14px;
      color: #666;
    }
    .billing-section {
      display: flex;
      justify-content: space-between;
      margin-bottom: 30px;
    }
    .billing-box {
      flex: 1;
      margin-right: 20px;
    }
    .billing-box:last-child {
      margin-right: 0;
    }
    .section-title {
      font-weight: bold;
      font-size: 14px;
      margin-bottom: 10px;
      color: #333;
      border-bottom: 1px solid #ddd;
      padding-bottom: 5px;
    }
    .items-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
    }
    .items-table th {
      background-color: #f5f5f5;
      padding: 10px;
      text-align: left;
      border-bottom: 2px solid #333;
      font-weight: bold;
    }
    .items-table td {
      padding: 8px;
      border-bottom: 1px solid #eee;
    }
    .totals-section {
      margin-top: 20px;
      text-align: right;
    }
    .totals-table {
      width: 300px;
      margin-left: auto;
      border-collapse: collapse;
    }
    .totals-table td {
      padding: 8px;
      border-bottom: 1px solid #eee;
    }
    .totals-table .label {
      text-align: right;
      font-weight: bold;
    }
    .totals-table .amount {
      text-align: right;
    }
    .total-row {
      font-weight: bold;
      font-size: 16px;
      border-top: 2px solid #333;
      border-bottom: 2px solid #333;
    }
    .status-badge {
      display: inline-block;
      padding: 5px 15px;
      border-radius: 20px;
      font-weight: bold;
      font-size: 12px;
      text-transform: uppercase;
    }
    .status-pending {
      background-color: #ffc107;
      color: #000;
    }
    .status-paid {
      background-color: #28a745;
      color: #fff;
    }
    .status-overdue {
      background-color: #dc3545;
      color: #fff;
    }
    .status-cancelled {
      background-color: #6c757d;
      color: #fff;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #ddd;
      text-align: center;
      color: #666;
      font-size: 10px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo-section">
        <div class="invoice-title">INVOICE</div>
        <div class="invoice-number">Invoice #: ${invoice.invoice_number}</div>
      </div>
      <div class="invoice-info">
        <div style="margin-bottom: 10px;">
          <span class="status-badge status-${invoice.status.toLowerCase()}">${invoice.status}</span>
        </div>
        <div><strong>Issue Date:</strong> ${formatDate(invoice.issue_date)}</div>
        ${invoice.due_date ? `<div><strong>Due Date:</strong> ${formatDate(invoice.due_date)}</div>` : ''}
      </div>
    </div>

    <div class="billing-section">
      <div class="billing-box">
        <div class="section-title">From (Garage)</div>
        <div><strong>${garage.garage_name || 'N/A'}</strong></div>
        ${garage.vts_number ? `<div>VTS Number: ${garage.vts_number}</div>` : ''}
        ${garage.address ? `<div>${garage.address}</div>` : ''}
        ${garage.city || garage.state ? `<div>${[garage.city, garage.state].filter(Boolean).join(', ')}</div>` : ''}
        ${garage.zip_code ? `<div>${garage.zip_code}</div>` : ''}
        ${garage.email ? `<div>Email: ${garage.email}</div>` : ''}
        ${garage.phone_number ? `<div>Phone: ${garage.phone_number}</div>` : ''}
      </div>
      <div class="billing-box">
        <div class="section-title">To (Driver)</div>
        <div><strong>${driver.name || 'N/A'}</strong></div>
        ${driver.address ? `<div>${driver.address}</div>` : ''}
        ${driver.city || driver.state ? `<div>${[driver.city, driver.state].filter(Boolean).join(', ')}</div>` : ''}
        ${driver.zip_code ? `<div>${driver.zip_code}</div>` : ''}
        ${driver.email ? `<div>Email: ${driver.email}</div>` : ''}
        ${driver.phone_number ? `<div>Phone: ${driver.phone_number}</div>` : ''}
      </div>
    </div>

    ${order && order.vehicle ? `
    <div style="margin-bottom: 20px;">
      <div class="section-title">Vehicle Information</div>
      <div>
        <strong>Registration:</strong> ${order.vehicle.registration_number || 'N/A'} | 
        <strong>Make:</strong> ${order.vehicle.make || 'N/A'} | 
        <strong>Model:</strong> ${order.vehicle.model || 'N/A'}
        ${order.vehicle.year_of_manufacture ? ` | <strong>Year:</strong> ${order.vehicle.year_of_manufacture}` : ''}
      </div>
    </div>
    ` : ''}

    <table class="items-table">
      <thead>
        <tr>
          <th>Description</th>
          <th style="text-align: center;">Quantity</th>
          <th style="text-align: right;">Unit Price</th>
          <th style="text-align: right;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${orderItemsHTML}
      </tbody>
    </table>

    <div class="totals-section">
      <table class="totals-table">
        <tr>
          <td class="label">Subtotal:</td>
          <td class="amount">${formatCurrency(subtotal)}</td>
        </tr>
        <tr>
          <td class="label">VAT (20%):</td>
          <td class="amount">${formatCurrency(vat)}</td>
        </tr>
        <tr class="total-row">
          <td class="label">Total:</td>
          <td class="amount">${formatCurrency(total)}</td>
        </tr>
      </table>
    </div>

    <div class="footer">
      <p>Thank you for your business!</p>
      <p>This is a computer-generated invoice. No signature required.</p>
    </div>
  </div>
</body>
</html>
    `;
  }
}
