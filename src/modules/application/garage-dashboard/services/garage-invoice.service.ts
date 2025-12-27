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
import { InvoiceStatus, Prisma } from '@prisma/client';

@Injectable()
export class GarageInvoiceService {
  private readonly logger = new Logger(GarageInvoiceService.name);

  constructor(private prisma: PrismaService) {}

  async getInvoices(
    userId: string,
    page: number = 1,
    limit: number = 10,
    status?: string,
    search?: string,
  ) {
    try {
      const skip = (page - 1) * limit;

      const where: Prisma.InvoiceWhereInput = {
        garage_id: userId,
      };

      if (status) {
        where.status = status as InvoiceStatus;
      }

      if (search) {
        const parsedDate = new Date(search);
        const isValidDate = !isNaN(parsedDate.getTime());

        let dateFilter = [];

        if (isValidDate) {
          const startOfDay = new Date(parsedDate);
          startOfDay.setHours(0, 0, 0, 0);

          const endOfDay = new Date(parsedDate);
          endOfDay.setHours(23, 59, 59, 999);

          dateFilter = [
            {
              issue_date: {
                gte: startOfDay,
                lte: endOfDay,
              },
            },
            {
              due_date: {
                gte: startOfDay,
                lte: endOfDay,
              },
            },
          ];
        }

        where.OR = [
          {
            invoice_number: {
              contains: search,
              mode: 'insensitive',
            },
          },
          {
            membership_period: {
              contains: search,
              mode: 'insensitive',
            },
          },
          {
            garage: {
              garage_name: {
                contains: search,
                mode: 'insensitive',
              },
            },
          },
          ...dateFilter,
        ];
      }

      const [invoices, total] = await Promise.all([
        this.prisma.invoice.findMany({
          where,
          skip,
          take: limit,
          orderBy: {
            created_at: 'desc',
          },
          select: {
            id: true,
            invoice_number: true,
            membership_period: true,
            issue_date: true,
            due_date: true,
            amount: true,
            status: true,
            created_at: true,
            pdf_url: true,
            garage_id: true,
          },
        }),
        this.prisma.invoice.count({ where }),
      ]);

      // Format invoices with PDF URL if exists
      const formattedInvoices = invoices.map((invoice) => {
        const invoiceData: any = {
          id: invoice.id,
          invoice_number: invoice.invoice_number,
          garage_id: invoice.garage_id,
          membership_period: invoice.membership_period,
          issue_date: invoice.issue_date,
          due_date: invoice.due_date,
          amount: invoice.amount.toString(),
          status: invoice.status,
          created_at: invoice.created_at,
          pdf_url: invoice.pdf_url,
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
      this.logger.error(
        `Error fetching invoices: ${error.message}`,
        error.stack,
      );
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
        select: {
          id: true,
          invoice_number: true,
          membership_period: true,
          issue_date: true,
          due_date: true,
          amount: true,
          status: true,
          created_at: true,
          updated_at: true,
          pdf_url: true,
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
        },
      });

      if (!invoice) {
        throw new NotFoundException('Invoice not found');
      }

      const invoiceData: any = {
        id: invoice.id,
        invoice_number: invoice.invoice_number,
        garage: invoice.garage,
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
      this.logger.error(
        `Error fetching invoice: ${error.message}`,
        error.stack,
      );
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
        select: {
          id: true,
          invoice_number: true,
          membership_period: true,
          issue_date: true,
          due_date: true,
          amount: true,
          status: true,
          created_at: true,
          updated_at: true,
          pdf_url: true,
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

      const garageSubscription = await this.prisma.garageSubscription.findFirst(
        {
          where: {
            garage_id: invoice.garage.id,
          },
          orderBy: {
            created_at: 'desc',
          },
          include: {
            plan: true,
          },
        },
      );

      const invoiceData = {
        ...invoice,
        subscription: {
          unitPrice: garageSubscription?.price_pence
            ? garageSubscription.price_pence / 100
            : invoice.amount || 0,
          planName: garageSubscription?.plan?.name,
          billingCycle: 'Monthly', // This is hardcoded, I should check if I can get this from the plan.
        },
      };

      // Generate PDF
      const pdfBuffer = await this.generateInvoicePDF(invoiceData);

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

  private generateInvoiceHTML(data: any): string {
    const vatRate = data.vatRate ?? 0;

    const subtotal = data.subscription.unitPrice;
    const vat = subtotal * vatRate;
    const total = subtotal + vat;

    const formatCurrency = (amount: number) => `£${amount.toFixed(2)}`;

    return `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>SimplyMot Invoice</title>

<style>
  :root {
    --brand: #19CA32;
    --muted: #6b7280;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 0;
    font-family: Arial, sans-serif;
    color: #111827;
  }
  .invoice-page {
    width: 794px;
    margin: auto;
    background: #fff;
    padding: 48px 56px;
  }
  .header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 40px;
  }
  .company h2 {
    margin: 0;
    font-size: 20px;
    font-weight: 800;
    color: var(--brand);
  }
  .company p {
    margin: 4px 0;
    font-size: 12px;
    color: var(--muted);
  }
  .invoice-title { text-align: right; }
  .invoice-title h1 {
    margin: 0;
    letter-spacing: 4px;
    font-size: 18px;
    color: var(--brand);
  }
  .bill {
    display: flex;
    justify-content: space-between;
    margin-bottom: 32px;
  }
  .bill h4 {
    margin: 0 0 8px;
    font-size: 13px;
    color: var(--brand);
  }
  .bill p { margin: 4px 0; font-size: 13px; }
  .meta p {
    display: flex;
    justify-content: space-between;
    gap: 24px;
    margin: 4px 0;
    font-size: 13px;
  }
  .meta span { color: var(--muted); }

  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 24px;
  }
  thead {
    background: #5f8f7c;
    color: #fff;
  }
  th, td {
    padding: 12px;
    font-size: 13px;
  }
  td { border-bottom: 1px solid #e5e7eb; }
  th.right, td.right { text-align: right; }
  td.center { text-align: center; }

  .totals {
    width: 300px;
    margin-left: auto;
    margin-top: 24px;
  }
  .totals div {
    display: flex;
    justify-content: space-between;
    padding: 8px 0;
    font-size: 13px;
  }
  .totals .grand {
    border-top: 1px solid #e5e7eb;
    margin-top: 10px;
    padding-top: 10px;
    font-weight: 600;
  }

  .invoice-footer {
    margin-top: 40px;
    text-align: center;
    font-size: 12px;
    color: #6b7280;
  }
  .footer-line {
    width: 100%;
    height: 1px;
    background: #e5e7eb;
    margin-bottom: 24px;
  }
  .footer-title {
    margin: 0 0 6px 0;
    font-weight: 600;
    color: #374151;
  }
  .footer-note {
    text-align: left;
    margin: 0;
    font-size: 11px;
  }
</style>
</head>

<body>
<div class="invoice-page">

  <div class="header">
    <div class="company">
      <h2>simplymot.co.uk</h2>
      <p>124 City Road, London, EC1V 2NX</p>
      <p>info@simplymot.co.uk</p>
    </div>
    <div class="meta">
      <p><span>Invoice #</span>${data.invoice_number}</p>
      <p><span>Invoice date</span>${format(new Date(data.issue_date), 'dd/MM/yyyy')}</p>
      <p><span>Due date</span>${format(new Date(data.due_date), 'dd/MM/yyyy')}</p>
    </div>
    <!-- <div class="invoice-title">
      <h1>INVOICE</h1>
    </div> -->
  </div>

  <div class="bill">
    <div>
      <h4>Bill To</h4>
      <p><strong>${data.garage.garage_name}</strong></p>
      ${data.garage.vts_number ? `<p>VTS Number: ${data.garage.vts_number}</p>` : ''}
      ${data.garage.address ? `<p>${data.garage.address}</p>` : ''}
      ${data.garage.city ? `<p>${data.garage.city}, ${data.garage.zip_code ?? ''}</p>` : ''}
      ${data.garage.email ? `<p>${data.garage.email}</p>` : ''}
      ${data.garage.phone_number ? `<p>${data.garage.phone_number}</p>` : ''}
    </div>

    
  </div>

  <table>
    <thead>
      <tr>
        <th>QTY</th>
        <th>Description</th>
        <th class="right">Unit Price</th>
        <th class="right">Amount</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="center">1</td>
        <td class="center">${data.subscription.planName} (${data.subscription.billingCycle} Subscription)</td>
        <td class="center">${formatCurrency(subtotal)}</td>
        <td class="right">${formatCurrency(subtotal)}</td>
      </tr>
    </tbody>
  </table>

  <div class="totals">
    <div>
      <span>Subtotal</span>
      <span>${formatCurrency(subtotal)}</span>
    </div>
    <div>
      <span>VAT (${vatRate * 100}%)</span>
      <span>${formatCurrency(vat)}</span>
    </div>
    <div class="grand">
      <span>Total</span>
      <span>${formatCurrency(total)}</span>
    </div>
  </div>

  <div class="invoice-footer">
    <div class="footer-line"></div>
    <!-- <p class="footer-title">Thank you for your business!</p> -->
    <p class="footer-note">
      simplymot.co.uk is an independent online MOT booking platform. This invoice relates to subscription services for garage listings and booking management only. Garage subscriptions are subject to the simplymot.co.uk Terms and Conditions for Garages, available at www.simplymot.co.uk and related platform policies. Legal Entity: A. Ahad (Sole Trader) trading as simplymot.co.uk | 124 City Road, London, EC1V 2NX | info@simplymot.co.uk 
    </p>
  </div>

</div>
</body>
</html>
`;
  }
}
