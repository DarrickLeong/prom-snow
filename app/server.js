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

// App
const app = express();

// --- Check for mandatory credentials ---
if (!CLIENT_ID || !CLIENT_SECRET || !SN_USERNAME || !SN_PASSWORD) {
  console.error("FATAL ERROR: Missing one or more required environment variables for ServiceNow authentication (CLIENT_ID, CLIENT_SECRET, SN_USERNAME, SN_PASSWORD).");
  // In a real app, you might exit or prevent the app from starting fully
  // For this example, requests will fail at login.
  // process.exit(1); // Uncomment to make the app exit if credentials are not set
}

const  itsmLogin = async () => {
  console.log('Attempting login to ServiceNow instance: ${SN_INSTANCE_URL}');
  const itsmLoginRequestConstruct ={
    baseURL: '${SN_INSTANCE_URL}/oauth_token.do',
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
  }
  const login = await axios.request(itsmLoginRequestConstruct)
  return login.data
}

//construct a uniue identfier for this alert , which will be later used to identify if it should update an existing or create a new incident
const constructUniqueString = (alert) => {
  return  alert.labels.alertname +"-"+ alert.labels.namespace+"-"+alert.fingerprint
}

// This is a search function to unique identify your record , which will decide to create a new or update an existing record
const searchQuery = async (login,uniqueString) => {
  const itsmSearchConstruct ={
    baseURL: "${SN_INSTANCE_URL}/api/now/table/incident",
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
  }
  const searchResult = await axios.request(itsmSearchConstruct)
  console.log("Search result")
  console.log(JSON.stringify(searchResult.data))
  return searchResult.data.result
}

const createRecord = async (login,uniqueString,alert) => {

  const itsmCreateConstruct ={
    baseURL: "${SN_INSTANCE_URL}/api/now/table/incident",
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
  }
  const createResult = await axios.request(itsmCreateConstruct)
  console.log("Record Created")
  console.log(JSON.stringify(createResult.data))
}

const updateRecord = async (login,sys_id,alert) => {

  const itsmUpdateConstruct ={
    baseURL: "${SN_INSTANCE_URL}/api/now/table/incident/"+sys_id,
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
  }
  const updateResult = await axios.request(itsmUpdateConstruct)
  console.log("Record Updated")
  console.log(JSON.stringify(updateResult.data.result))
  
}

const closeRecord = async (login,sys_id,alert) => {


  const itsmCloseConstruct ={
    baseURL: "${SN_INSTANCE_URL}/api/now/table/incident/"+sys_id,
    method: "PUT",
    rejectUnauthorized: false,
    data: {
      //"work_notes": alert,
      "work_notes": `New alert received. Annotations: ${JSON.stringify(alert.annotations, null, 2)}`,
      "state": 6,
      "close_notes": "Closed with error resolved from prom", // can be set via prom labels like alert.labels.close_notes 
      "close_code": "Resolved by request" // can be set via prom labels like alert.labels.close_code 
      //add more fields as you see fit , PrometheusRule labels are avaiable via alert.label.<LABEL_NAME> environment variables are available as process.env.<ENV_VARIABLE>
    },
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer '+login.access_token
    }      
  }
  const closeResult = await axios.request(itsmCloseConstruct)
  console.log("Record Closed")
  console.log(JSON.stringify(closeResult.data.result))
  
}



const requestParse = async (body) => {
  const login = await itsmLogin();
  body.alerts.forEach(async (alert) => {
        try {    
          
                  console.log("Alert result")
                  console.log(JSON.stringify(alert))
                  const result = await searchQuery(login,constructUniqueString(alert))
                  
                  console.log("Search array")
                  console.log(JSON.stringify(result))
                  if(result.length == 0 && alert.status === "firing") {  // no record exists create new record
                    await createRecord(login,constructUniqueString(alert),alert)
                  } else if(result.length == 1 && alert.status === "firing") { // update record with last info
                    await updateRecord(login,result[0].sys_id,alert)
                  } else if(result.length == 1 && alert.status === "resolved") { // resolve record
                    await closeRecord(login,result[0].sys_id,alert)
                  } else { // somthing is wrong
                    console.log("more than 1 record found for search criteria")
                    console.log(alert)
                    console.log("Search string: "+constructUniqueString(alert))
                  }
         }
         catch (e) {
          console.log(e)
         }
    });
};



app.post('/',jsonParser, async (req, res) => {
  await requestParse(req.body)
  res.send('Success');
});

app.listen(PORT, HOST, () => {
  console.log(`Running on http://${HOST}:${PORT}`);
});