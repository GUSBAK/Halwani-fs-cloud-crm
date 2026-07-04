# Data Import Guide

Use the **Admin Import Centre** in the app with a Head of Food Service or Admin account.

## Customer database update

Accepted Excel fields:

- Customer Code
- Customer Name
- Branch
- City
- Area
- Channel
- Sub Channel
- Contact Name
- Mobile
- Salesman ID or Salesman Name
- Status
- Approval Code
- Gross Sales YTD
- Monthly Average Gross Sales
- GPS Latitude
- GPS Longitude
- GPS Radius
- Notes

The import uses `Customer Code` as the unique key. Uploading the same code updates the existing record.

## Monthly Journey Plan

The supplied template supports the attached columns exactly:

- Month
- Salesman ID
- Salesman Name
- Visit Date
- Visit Time
- Customder Code
- Customer Name
- Branch
- City
- Area
- Notes

The app resolves the Salesman ID against `profiles.employee_code`, and resolves `Customder Code` against `customers.customer_code`.

## Monthly Collection Targets

The supplied template supports the attached columns exactly:

- Month
- Salesman ID
- Salesman Name
- Customer Code
- customerName
- Collection Target( SAR)
- dueDate
- Sales Target (SAR)
- notes

The import uses the combination of month, salesman, and customer as the unique collection target.

## Important

Create salespeople in Supabase Auth first. Then set their `employee_code`, `full_name`, `role`, `region`, and `manager_id` in `public.profiles`. The import cannot match a salesperson who does not yet exist in the Profiles table.
