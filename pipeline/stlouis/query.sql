-- St. Louis termite territory map: per-zip metrics.
-- Run via RevHawk run_query. Save the returned rows to pipeline/stlouis/rows.json, then run build.mjs.
-- Scope: St. Louis office (7), Missouri zips across St. Louis City/County, St. Charles, Jefferson, and Warren counties.
-- The termite program has not launched here yet -- active_termite / termite_arv will be 0 for every zip.
-- That's expected: this map exists to show where the existing customer book is concentrated, geographically,
-- so appointment-setting can start with an efficient calling/driving route rather than scattering it randomly.

WITH cust AS (
  SELECT
    fieldRoutes_customerID AS cid,
    fieldRoutes_zip   AS zip,
    fieldRoutes_city  AS city,
    fieldRoutes_county AS county,
    CAST(fieldRoutes_status AS INT64) AS status,
    fieldRoutes_aPay AS apay,
    CAST(fieldRoutes_commercialAccount AS INT64) AS commercial,
    DATE(SAFE_CAST(fieldRoutes_dateAdded AS DATETIME)) AS date_added
  FROM `revhawkdataconnect.org_evo_pest_control_33cdcd.FieldRoutesCustomer`
  WHERE fieldRoutes_officeID = '7'
    AND fieldRoutes_state = 'MO'
    AND fieldRoutes_zip != ''
    AND fieldRoutes_county IN (
      'St Louis','Saint Louis','St. Louis','Saint Louis City',
      'St Charles','Saint Charles','Jefferson','Warren')
),
zip_meta AS (
  SELECT zip, ANY_VALUE(city) AS city, ANY_VALUE(county) AS county FROM (
    SELECT zip, city, county,
           ROW_NUMBER() OVER (PARTITION BY zip ORDER BY COUNT(*) DESC) rn
    FROM cust WHERE county NOT IN ('','0','-1') GROUP BY zip, city, county
  ) WHERE rn = 1 GROUP BY zip
),
-- Active preventative termite coverage. Will be empty until the program launches --
-- kept identical to the Wichita query so the two territories stay comparable once it does.
term AS (
  SELECT fieldRoutes_customerID AS cid,
         COUNT(*) AS term_subs,
         SUM(SAFE_CAST(fieldRoutes_annualRecurringValue AS FLOAT64)) AS term_arv
  FROM `revhawkdataconnect.org_evo_pest_control_33cdcd.FieldRoutesSubscription`
  WHERE fieldRoutes_officeID = '7'
    AND LOWER(fieldRoutes_serviceType) LIKE '%termite%'
    AND LOWER(fieldRoutes_serviceType) NOT LIKE '%inspection%'
    AND LOWER(fieldRoutes_serviceType) NOT LIKE '%test%'
    AND fieldRoutes_active = '1'
    AND fieldRoutes_dateCancelled = '0000-00-00 00:00:00'
  GROUP BY 1
),
allsubs AS (
  SELECT fieldRoutes_customerID AS cid,
         SUM(SAFE_CAST(fieldRoutes_annualRecurringValue AS FLOAT64)) AS total_arv
  FROM `revhawkdataconnect.org_evo_pest_control_33cdcd.FieldRoutesSubscription`
  WHERE fieldRoutes_officeID = '7'
    AND fieldRoutes_active = '1'
    AND fieldRoutes_dateCancelled = '0000-00-00 00:00:00'
  GROUP BY 1
),
insp AS (
  SELECT fieldRoutes_customerID AS cid,
         COUNTIF(fieldRoutes_statusText = 'Completed') AS insp_completed,
         COUNTIF(fieldRoutes_statusText = 'Pending')   AS insp_pending,
         MAX(IF(fieldRoutes_statusText = 'Completed',
                DATE(SAFE_CAST(fieldRoutes_date AS DATETIME)), NULL)) AS last_completed
  FROM `revhawkdataconnect.org_evo_pest_control_33cdcd.FieldRoutesAppointment`
  WHERE fieldRoutes_officeID = '7'
    AND fieldRoutes_type IN ('58','133','44','36','117','111')
    AND DATE(SAFE_CAST(fieldRoutes_date AS DATETIME))
        BETWEEN DATE_TRUNC(CURRENT_DATE(), YEAR) AND DATE_ADD(DATE_TRUNC(CURRENT_DATE(), YEAR), INTERVAL 1 YEAR)
  GROUP BY 1
)
SELECT
  c.zip,
  ANY_VALUE(zm.city)   AS city,
  ANY_VALUE(zm.county) AS county,
  COUNT(*)                                        AS total_customers,
  COUNTIF(c.status = 1)                           AS active_customers,
  COUNTIF(c.status = 1 AND c.commercial = 1)      AS active_commercial,
  COUNTIF(c.status = 1 AND t.cid IS NOT NULL)     AS active_termite,
  ROUND(SUM(IF(c.status = 1, t.term_arv, 0)), 0)  AS termite_arv,
  ROUND(SUM(IF(c.status = 1, s.total_arv, 0)), 0) AS total_arv,
  COUNTIF(c.status = 1 AND c.apay IN ('CC','ACH')) AS autopay,
  SUM(IF(c.status = 1, i.insp_completed, 0))      AS insp_completed,
  SUM(IF(c.status = 1, i.insp_pending, 0))        AS insp_pending,
  COUNTIF(c.status = 1 AND i.insp_completed > 0)  AS cust_inspected,
  COUNTIF(c.status = 1 AND i.insp_pending > 0)    AS cust_scheduled,
  CAST(MAX(i.last_completed) AS STRING)           AS last_inspection,
  ROUND(AVG(IF(c.status = 1,
    DATE_DIFF(CURRENT_DATE(), c.date_added, DAY) / 365.25, NULL)), 1) AS avg_tenure_yrs
FROM cust c
LEFT JOIN zip_meta zm ON zm.zip = c.zip
LEFT JOIN term    t  ON t.cid  = c.cid
LEFT JOIN allsubs s  ON s.cid  = c.cid
LEFT JOIN insp    i  ON i.cid  = c.cid
GROUP BY c.zip
ORDER BY active_customers DESC
