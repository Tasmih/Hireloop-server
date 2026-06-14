const dns = require("node:dns");
dns.setDefaultResultOrder("ipv4first");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const express = require('express')
const cors = require('cors');
const app = express()
const port = 5000

require('dotenv').config()

app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

app.get('/', (req, res,) => {
  res.send('Hello World!')
})

// middleware
const logger = (req, res, next) => {
  console.log('logger middleware logger', req.params)
  next();
}

const uri = process.env.MONGO_DB_URI

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    await client.connect();

    const database = client.db("hireloop_db");
    const jobCollection = database.collection("jobs");
    const companyCollection = database.collection('companies');
    const usersCollection = database.collection("user");
    const applicationsCollection = database.collection("applications");
    const planCollection = database.collection('plans');
    const subscriptionCollection = database.collection('subscriptions');
    const sessionCollection = database.collection('session');

    // Verification related
    const verifyToken = async (req, res, next) => {
      const authHeader = req.headers?.authorization;

      if (!authHeader) {
        return res.status(401).send({
          message: 'unauthorized access'
        })
      }

      const token = authHeader.split(' ')[1]
      if (!token) {
        return res.status(402).send({ message: 'aunthorized access' })
      }

      const query = { token: token }
      const session = await sessionCollection.findOne(query);

      console.log(session);

      if (!session) {
        return res.status(401).send({ message: "invalid session" })
      }

      const userId = session.userId;

      const userQuery = {
        _id: new ObjectId(userId)
      }

      const user = await usersCollection.findOne(userQuery);

      req.user = user
      next();
    }

    // must be used after verifyToken middleware 
    const verifySeeker = async (req, res, next) => {
      if (req.user?.role !== 'seeker') {
        return res.status(403).send({ message: 'forbidden access' })
      }
      next();
    }

    // must be used after verifyToken middleware 
    const verifyAdmin = async (req, res, next) => {
      if (req.user?.role !== 'admin') {
        return res.status(403).send({ message: 'forbidden access' })
      }
      next();
    }

    // must be used after verifyToken middleware 
    const verifyRecruiter = async (req, res, next) => {
      if (req.user?.role !== 'recruiter') {
        return res.status(403).send({ message: 'forbidden access' })
      }
      next();
    }

    app.get('/api/users', async (req, res) => {
      const cursor = usersCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    })

    app.get('/api/jobs', async (req, res) => {
      const query = {};
      if (req.query.companyId) {
        query.companyId = req.query.companyId;
      }
      if (req.query.status) {
        query.status = req.query.status;
      }
      const cursor = jobCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    })

    app.get('/api/jobs/:id', async (req, res) => {
      const id = req.params.id;
      const query = {
        _id: new ObjectId(id)
      }
      const result = await jobCollection.findOne(query);
      console.log("Job result:", result);
      res.send(result);
    })

    app.post('/api/jobs', async (req, res) => {
      const job = req.body;
      const newJob = {
        ...job,
        createdAt: new Date()
      }
      const result = await jobCollection.insertOne(newJob);
      res.send(result);
    })

    // application related apis
    app.get('/api/applications', verifyToken, verifySeeker, async (req, res) => {
      const query = {};

      if (req.query.applicantId) {
        query.applicantId = req.query.applicantId;

        console.log(req.user, req.query.applicantId)

        if (req.user._id.toString() !== req.query.applicantId) {
          return res.status(403).send({ message: 'forbidden access' })
        }
      }

      if (req.query.jobId) {
        query.jobId = req.query.jobId;
      }

      const cursor = applicationsCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    })

    app.post('/api/applications', async (req, res) => {
      const application = req.body;
      const newApplication = {
        ...application,
        createdAt: new Date()
      }
      const result = await applicationsCollection.insertOne(newApplication);
      res.send(result);
    })

    // company related apis
    app.get('/api/companies', verifyToken, verifyAdmin, async (req, res) => {
      const cursor = companyCollection.find();
      const companies = await cursor.toArray();

      for (const company of companies) {
        const filter = {
          companyId: company._id.toString()
        }
        const jobCount = await jobCollection.countDocuments(filter)
        company.jobCount = jobCount
      }

      res.send(companies);
    })

    app.get('/api/companies2', async (req, res) => {
      const pipeline = [
        { $skip: 5 },
        { $limit: 2 }
      ];

      const cursor = companyCollection.aggregate(pipeline);
      const result = await cursor.toArray();
      res.send(result)
    })

    app.get('/api/stats', async (req, res) => {
      const pipeline = [
        {
          $group: {
            _id: '$jobType',
            count: { $sum: 1 }
          }
        },
        {
          $project: {
            jobType: '$_id',
            _id: 0,
            count: 1
          }
        },
        {
          $sort: { count: 1 }
        }
      ]

      const cursor = jobCollection.aggregate(pipeline);
      const result = await cursor.toArray();
      res.send(result);
    })

    app.get('/api/my/companies', async (req, res) => {
      const query = {};
      if (req.query.recruiterId) {
        query.recruiterId = req.query.recruiterId;
      }
      const result = await companyCollection.findOne(query);
      res.send(result || {});
    })

    app.post('/api/companies', async (req, res) => {
      const company = req.body;
      const newCompany = {
        ...company,
        createdAt: new Date()
      }
      const result = await companyCollection.insertOne(newCompany);
      res.send(result);
    })

    app.patch('/api/companies/:id', logger, verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      console.log("Approved company ID:", id);

      const updatedCompany = req.body;
      const filter = { _id: new ObjectId(id) }

      const updatedDoc = {
        $set: {
          status: updatedCompany.status
        }
      }

      const result = await companyCollection.updateOne(filter, updatedDoc);
      res.send(result);
    })

    // plans
    app.get('/api/plans', async (req, res) => {
      const query = {}
      if (req.query.plan_id) {
        query.id = req.query.plan_id
      }
      const plan = await planCollection.findOne(query);
      res.send(plan)
    })

   gi

    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");

  } finally {
    // await client.close();
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})