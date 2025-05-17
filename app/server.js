'use strict';

const express = require('express');
const axios = require('axios');
var querystring = require('querystring');

var bodyParser = require('body-parser')
var jsonParser = bodyParser.json()

// Constants
const PORT = 8080;
const HOST = '0.0.0.0';

// --- Configuration from Environment Variables ---
// ServiceNow Instance URL
const SN_INSTANCE_URL = process.env.SN_INSTANCE_URL

// Credentials (these should be set in your OpenShift environment via Secrets)
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SN_USERNAME = process.env.SN_USERNAME;
const SN_PASSWORD = process.env.SN_PASSWORD;

// SSL Certificate Validation for Axios
// Set REJECT_UNAUTHORIZED to "false" (string) in env to disable, otherwise defaults to true
const REJECT_UNAUTHORIZED = !(process.env.REJECT_UNAUTHORIZED === "false");

// App
const app = express();

// --- Check for mandatory credentials ---
if (!CLIENT_ID || !CLIENT_SECRET || !SN_USERNAME || !SN_PASSWORD) {
  console.error("FATAL ERROR: Missing one or more required environment variables for ServiceNow authentication (CLIENT_ID, CLIENT_SECRET, SN_USERNAME, SN_PASSWORD).");
  // In a real app, you might exit or prevent the app from starting fully
  // For this example, requests will fail at login.
  // process.exit(1); // Uncomment to make the app exit if credentials are not set
}
if (!SN_INSTANCE_URL) {
  console.error("FATAL ERROR: SN_INSTANCE_URL environment variable is not set. Cannot connect to ServiceNow.");
  // Consider: process.exit(1);
}

const  itsmLogin = async () => {
  console.log(`Attempting login to ServiceNow instance: ${SN_INSTANCE_URL}`);
  const itsmLoginRequestConstruct ={
    baseURL: `${SN_INSTANCE_URL}/oauth_token.do`,
    method: "POST",
    rejectUnauthorized: false,
    data: querystring.stringify({
      grant_type: 'password',   
      client_id: CLIENT_ID, // Process.env.client_id  to obtain from environment variables
      client_secret: CLIENT_SECRET, // Process.env.client_secret  to obtain from environment variables
      username: SN_USERNAME, // Process.env.username  to obtain from environment variables
      password: SN_PASSWORD  // Process.env.password  to obtain from environment variables
      }),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }      
  };
  const login = await axios.request(itsmLoginRequestConstruct);
  return login.data;
};

//construct a uniue identfier for this alert , which will be later used to identify if it should update an existing or create a new incident
const constructUniqueString = (alert) => {
  return  alert.labels.alertname +"-"+ alert.labels.namespace+"-"+alert.fingerprint;
}

// This is a search function to unique identify your record , which will decide to create a new or update an existing record
const searchQuery = async (login,uniqueString) => {
  const itsmSearchConstruct ={
    baseURL: `${SN_INSTANCE_URL}/api/now/table/incident`,
    method: "GET",
    rejectUnauthorized: false,
    params: {
      sysparm_limit: 10,
      // In my case, I am using a unique short_description however you can choose any field
      short_description: uniqueString
    },
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Bearer '+login.access_token
    }      
  };
  const searchResult = await axios.request(itsmSearchConstruct);
  // console.log("Search result")
  // console.log(JSON.stringify(searchResult.data))
  console.log(`Search for '${uniqueString}': ${searchResult.data.result.length} record(s) found.`);
  return searchResult.data.result;
};

const createRecord = async (login,uniqueString,alert) => {

  const itsmCreateConstruct ={
    baseURL: `${SN_INSTANCE_URL}/api/now/table/incident`,
    method: "POST",
    rejectUnauthorized: false,
    data: {
      "short_description": uniqueString,
      //"description": alert,// can be set via prom labels like alert.labels.description
      "description": JSON.stringify(alert, null, 2), // Prettify the JSON 
      //"work_notes": alert// can be set via prom labels like alert.labels.work_notes
      "work_notes": `New alert received. Annotations: ${JSON.stringify(alert.annotations, null, 2)}`
      //add more fields as you see fit , PrometheusRule labels are avaiable via alert.label.<LABEL_NAME> environment variables are available as process.env.<ENV_VARIABLE>
    },
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer '+login.access_token
    }      
  };
  const createResult = await axios.request(itsmCreateConstruct)
  // console.log("Record Created")
  // console.log(JSON.stringify(createResult.data))
  console.log(`Record Created for '${uniqueString}'. Sys ID: ${createResult.data.result && createResult.data.result.sys_id}`);
};

const updateRecord = async (login,sys_id,alert) => {

  const itsmUpdateConstruct ={
    baseURL: `${SN_INSTANCE_URL}/api/now/table/incident/${sys_id}`,
    method: "PUT",
    rejectUnauthorized: false,
    data: {
      //"work_notes": alert
      "work_notes": `New alert received. Annotations: ${JSON.stringify(alert.annotations, null, 2)}`
      //add more fields as you see fit , PrometheusRule labels are avaiable via alert.label.<LABEL_NAME> environment variables are available as process.env.<ENV_VARIABLE>
    },
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer '+login.access_token
    }      
  };
  // const updateResult = await axios.request(itsmUpdateConstruct)
  // console.log("Record Updated")
  // console.log(JSON.stringify(updateResult.data.result))
  await axios.request(itsmUpdateConstruct);
  console.log(`Record Updated for sys_id: ${sys_id}`);
};

const closeRecord = async (login,sys_id,alert) => {

  const itsmCloseConstruct ={
    baseURL: `${SN_INSTANCE_URL}/api/now/table/incident/${sys_id}`,
    method: "PUT",
    rejectUnauthorized: false,
    data: {
      //"work_notes": alert,
      "work_notes": `New alert received. Annotations: ${JSON.stringify(alert.annotations, null, 2)}`,
      "state": 6,
      // "close_notes": "Closed with error resolved from prom", // can be set via prom labels like alert.labels.close_notes 
      // "close_code": "Resolved by request" // can be set via prom labels like alert.labels.close_code
      "close_notes": alert.labels.close_notes || "Closed: Alert resolved by Prometheus.",
      "close_code": alert.labels.close_code || "Resolved by monitoring" 
      //add more fields as you see fit , PrometheusRule labels are avaiable via alert.label.<LABEL_NAME> environment variables are available as process.env.<ENV_VARIABLE>
    },
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer '+login.access_token
    }      
  };
  // const closeResult = await axios.request(itsmCloseConstruct)
  // console.log("Record Closed")
  // console.log(JSON.stringify(closeResult.data.result))
  await axios.request(itsmCloseConstruct);
  console.log(`Record Closed for sys_id: ${sys_id}`);
};



// const requestParse = async (body) => {
//   const login = await itsmLogin();
//   body.alerts.forEach(async (alert) => {
//         try {    
          
//                   console.log("Alert result")
//                   console.log(JSON.stringify(alert))
//                   const result = await searchQuery(login,constructUniqueString(alert))
                  
//                   console.log("Search array")
//                   console.log(JSON.stringify(result))
//                   if(result.length == 0 && alert.status === "firing") {  // no record exists create new record
//                     await createRecord(login,constructUniqueString(alert),alert)
//                   } else if(result.length == 1 && alert.status === "firing") { // update record with last info
//                     await updateRecord(login,result[0].sys_id,alert)
//                   } else if(result.length == 1 && alert.status === "resolved") { // resolve record
//                     await closeRecord(login,result[0].sys_id,alert)
//                   } else { // somthing is wrong
//                     console.log("more than 1 record found for search criteria")
//                     console.log(alert)
//                     console.log("Search string: "+constructUniqueString(alert))
//                   }
//          }
//          catch (e) {
//           console.log(e)
//          }
//     });
// };


// app.post('/',jsonParser, async (req, res) => {
//   await requestParse(req.body)
//   res.send('Success');
// });

// app.listen(PORT, HOST, () => {
//   console.log(`Running on http://${HOST}:${PORT}`);
// });

// --- Main Request Parsing and Alert Processing Logic ---
const requestParse = async (body) => {
  let servicenowLoginData; // To store the login response

  try {
    console.log("Attempting ServiceNow login...");
    servicenowLoginData = await itsmLogin(); // Call the login function

    // **Explicitly check for access_token**
    if (!servicenowLoginData || !servicenowLoginData.access_token) {
      const responseDetails = servicenowLoginData ? JSON.stringify(servicenowLoginData).substring(0, 200) + "..." : "No data returned from login attempt.";
      console.error("ServiceNow login failed: No access token received in the response.", responseDetails);
      // This error will be caught by the app.post route handler's catch block
      throw new Error("ServiceNow authentication failed: Access token missing. Check credentials and OAuth client setup.");
    }
    console.log("ServiceNow login successful. Access token obtained.");

  } catch (error) {
    // This catch block handles errors from itsmLogin() or the access_token check
    let errorMessage = "ServiceNow Login Failure";
    if (error.response && error.response.data) { // Axios error with response data
        errorMessage += `: ${error.response.status} ${JSON.stringify(error.response.data)}`;
    } else if (error.message) {
        errorMessage += `: ${error.message}`;
    } else {
        errorMessage += `: Unknown error during login.`;
    }
    console.error(errorMessage, error.stack ? error.stack.split('\n').slice(0,3).join('\n') : ''); // Log concise stack
    throw new Error(errorMessage); // Propagate a clear error message to app.post
  }

  // If login was successful, proceed to process alerts
  // Changed from forEach to for...of loop for correct async/await handling
  console.log(`Processing ${body.alerts.length} alert(s) sequentially...`);
  for (const alert of body.alerts) {
    try {
      const uniqueString = constructUniqueString(alert);
      console.log(`Processing alert: ${uniqueString}, Status: ${alert.status}`);
      // console.log("Full alert object:", JSON.stringify(alert, null, 2)); // Uncomment for detailed alert view

      // Pass servicenowLoginData to ServiceNow functions
      const searchResults = await searchQuery(servicenowLoginData, uniqueString);

      if (searchResults.length === 0 && alert.status === "firing") {
        await createRecord(servicenowLoginData, uniqueString, alert);
      } else if (searchResults.length === 1 && alert.status === "firing") {
        await updateRecord(servicenowLoginData, searchResults[0].sys_id, alert);
      } else if (searchResults.length === 1 && alert.status === "resolved") {
        await closeRecord(servicenowLoginData, searchResults[0].sys_id, alert);
      } else if (searchResults.length > 1) {
        console.error(`ALERT_PROCESSING_ERROR: More than one record found for '${uniqueString}'. Alert: ${JSON.stringify(alert.labels)}`);
      } else {
        console.warn(`ALERT_PROCESSING_WARN: Unhandled case for '${uniqueString}'. Status: ${alert.status}, Search count: ${searchResults.length}`);
      }
    } catch (e) {
      // Log error for individual alert processing but don't let it stop other alerts in the loop
      const alertIdentifier = alert.fingerprint || JSON.stringify(alert.labels);
      console.error(`ALERT_PROCESSING_FAILED for alert '${alertIdentifier}': ${e.message}`, e.stack ? e.stack.split('\n').slice(0,3).join('\n') : '');
      // Depending on requirements, you might want to collect these errors.
    }
  }
  console.log("Finished processing all alerts in the batch.");
};

// --- Express Route Handler ---
app.post('/', jsonParser, async (req, res) => {
  try {
    if (!req.body || !Array.isArray(req.body.alerts) || req.body.alerts.length === 0) {
        console.warn("Received request without alerts payload or empty alerts array.");
        return res.status(400).send('Bad Request: Missing or empty alerts payload.');
    }
    console.log(`Received webhook. Number of alerts: ${req.body.alerts.length}. Common Labels: ${JSON.stringify(req.body.commonLabels || {})}`);
    await requestParse(req.body);
    res.status(200).send('Success: Alerts processed.');
  } catch (error) {
    // This catches errors propagated from requestParse (including login failures or other critical errors)
    console.error("OVERALL_REQUEST_ERROR: Failed to process alert payload:", error.message);
    // error.stack might be too verbose for production logs but useful for debugging
    // console.error(error.stack);
    res.status(500).send(`Error processing request: ${error.message}`);
  }
});

// --- Start Server ---
app.listen(PORT, HOST, () => {
  console.log(`ServiceNow Webhook Receiver running on http://${HOST}:${PORT}`);
  console.log(`Target ServiceNow instance: ${SN_INSTANCE_URL || "NOT SET (CRITICAL ERROR)"}`);
  console.log(`SSL Certificate Validation (rejectUnauthorized): ${REJECT_UNAUTHORIZED}`);
  if (!CLIENT_ID || !CLIENT_SECRET || !SN_USERNAME || !SN_PASSWORD || !SN_INSTANCE_URL) {
    console.warn("WARNING: One or more critical ServiceNow environment variables are missing. Application may not function correctly.");
  } else {
    console.log("ServiceNow critical environment variables appear to be set.");
  }
});