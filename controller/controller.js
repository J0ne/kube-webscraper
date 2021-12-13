const k8s = require("@kubernetes/client-node");
const request = require("request");
const JSONStream = require("json-stream");
const mustache = require("mustache");
const fs = require("fs").promises;

const kc = new k8s.KubeConfig();

process.env.NODE_ENV === "development"
  ? kc.loadFromDefault()
  : kc.loadFromCluster();

process.on("unhandledRejection", (err, p) => {
  console.log("An unhandledRejection occurred");
  console.log(`Rejected Promise: ${p}`);
  console.log(`Rejection: ${err}`);
});

const opts = {};
kc.applyToRequest(opts);

const client = kc.makeApiClient(k8s.CoreV1Api);

const sendRequestToApi = async (api, method = "get", options = {}) =>
  new Promise((resolve, reject) =>
    request[method](
      `${kc.getCurrentCluster().server}${api}`,
      { ...opts, ...options, headers: { ...options.headers, ...opts.headers } },
      (err, res) => (err ? reject(err) : resolve(JSON.parse(res.body)))
    )
  ).catch((error) => console.log(error));

const fieldsFromDummySite = (object) => ({
  dummysite_name: object.metadata.name,
  container_name: object.metadata.name,
  job_name: `${object.metadata.name}-job-webscraper`,
  namespace: object.metadata.namespace,
  website_url: object.spec.website_url,
  image: object.spec.image,
});

const fieldsFromJob = (object) => ({
  dummysite_name: object.metadata.labels.dummysite,
  container_name: object.metadata.labels.dummysite,
  job_name: `${object.metadata.labels.dummysite}-job-webscraper`,
  namespace: object.metadata.namespace,
  website_url: object.metadata.labels.website_url,
  image: object.spec.template.spec.containers[0].image,
});

const getJobYAML = async (fields) => {
  try {
    const deploymentTemplate = await fs.readFile("job.mustache", "utf-8");
    return mustache.render(deploymentTemplate, fields);
  } catch (error) {
    console.log(error);
  }
};

const jobForDummysiteAlreadyExists = async (fields) => {
  const { dummysite_name, namespace } = fields;
  const { items } = await sendRequestToApi(
    `/apis/batch/v1/namespaces/${namespace}/jobs`
  );
    const result = items.find(
      (item) => item.metadata.labels.dummysite === dummysite_name
    );
     console.log("jobForDummysiteAlreadyExists:", result);
  return result;
};

const createJob = async (fields) => {
  console.log(fields.dummysite_name, "to namespace", fields.namespace);

  const yaml = await getJobYAML(fields);
  console.log("Creating Job with this: ", yaml);
  return sendRequestToApi(
    `/apis/batch/v1/namespaces/${fields.namespace}/jobs`,
    "post",
    {
      headers: {
        "Content-Type": "application/yaml",
      },
      body: yaml,
    }
  );
};

const removeJob = async ({ namespace, job_name }) => {
  let pods = null;
  try {
    pods = await sendRequestToApi(`/api/v1/namespaces/${namespace}/pods/`);
  } catch (error) {
    console.log(error);
  }

  pods.items
    .filter((pod) => pod.metadata.labels["job-name"] === job_name)
    .forEach((pod) => removePod({ namespace, pod_name: pod.metadata.name }));

  return sendRequestToApi(
    `/apis/batch/v1/namespaces/${namespace}/jobs/${job_name}`,
    "delete"
  );
};

// const removeDummysite = ({ namespace, dummysite_name }) =>
//   sendRequestToApi(
//     `/apis/stable.dwk/v1/namespaces/${namespace}/dummysites/${dummysite_name}`,
//     "delete"
//   );

const removePod = ({ namespace, pod_name }) =>
  sendRequestToApi(
    `/api/v1/namespaces/${namespace}/pods/${pod_name}`,
    "delete"
  );

const cleanupForDummysite = async ({ namespace, dummysite_name }) => {
  console.log("Doing cleanup");
  clearTimeout(timeouts[dummysite_name]);

  const jobs = await sendRequestToApi(
    `/apis/batch/v1/namespaces/${namespace}/jobs`
  );
  jobs.items.forEach((job) => {
    if (!job.metadata.labels.dummysite === dummysite_name) return;

    removeJob({ namespace, job_name: job.metadata.name });
  });
};
const maintainStatus = async () => {
  (await client.listPodForAllNamespaces()).body; // A bug in the client(?) was fixed by sending a request and not caring about response

  /**
   * Watch dummysites
   */

  const dummysite_stream = new JSONStream();

  dummysite_stream.on("data", async ({ type, object }) => {
    console.log("Stream: type & object", type, object);
    const fields = fieldsFromDummySite(object);

    if (type === "ADDED") {
      if (await jobForDummysiteAlreadyExists(fields)) return; // Restarting application would create new 0th jobs without this check

      createJob(fields);
    }
    if (type === "DELETED") cleanupForDummysite(fields);
  });

  request
    .get(
      `${
        kc.getCurrentCluster().server
      }/apis/stable.dwk/v1/dummysites?watch=true`,
      opts
    )
    .pipe(dummysite_stream);

  /**
   * Watch Jobs
   */

    const job_stream = new JSONStream();

    job_stream.on("data", async ({ type, object }) => {
      if (!object.metadata.labels.dummysite) return; // If it's not dummysite job don't handle
      if (type === "DELETED" || object.metadata.deletionTimestamp) return; // Do not handle deleted jobs
      if (!object?.status?.succeeded) return;

      rescheduleJob(object);
    });

    request
      .get(`${kc.getCurrentCluster().server}/apis/batch/v1/jobs?watch=true`, opts)
      .pipe(job_stream);
};

maintainStatus();
