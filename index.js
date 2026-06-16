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

// Logger middleware - logs request params for debugging
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

    //  MIDDLEWARE 

    // Verifies the Bearer token from Authorization header
    // Looks up the session in DB and attaches user to req.user
    const verifyToken = async (req, res, next) => {
      const authHeader = req.headers?.authorization;

      if (!authHeader) {
        return res.status(401).send({
          message: 'unauthorized access'
        })
      }

      const token = authHeader.split(' ')[1]
      if (!token) {
        return res.status(401).send({ message: 'unauthorized access' })
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
      if (!user) {
        return res.status(401).send({ message: "unauthorized access" })
      }

      // Attach user object to request for downstream middleware/routes
      req.user = user
      next();
    }

    // Must be used after verifyToken - allows only seekers
    const verifySeeker = async (req, res, next) => {
      if (req.user?.role !== 'seeker') {
        return res.status(403).send({ message: 'forbidden access' })
      }
      next();
    }

    // Must be used after verifyToken - allows only admins
    const verifyAdmin = async (req, res, next) => {
      if (req.user?.role !== 'admin') {
        return res.status(403).send({ message: 'forbidden access' })
      }
      next();
    }

    // Must be used after verifyToken - allows only recruiters
    const verifyRecruiter = async (req, res, next) => {
      if (req.user?.role !== 'recruiter') {
        return res.status(403).send({ message: 'forbidden access' })
      }
      next();
    }

    // USER ROUTES 

    // Get all users
    app.get('/api/users', async (req, res) => {
      const cursor = usersCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    })

    // JOB ROUTES 

    // Get jobs with optional filters and pagination
    // Filters: search (jobTitle), jobType, jobCategory, isRemote, companyId, status
    app.get('/api/jobs', async (req, res) => {
        console.log('server side q', req.query);
        const query = {};
        
        // Search by jobTitle (matches DB field name)
        if (req.query.search) {
            query.$or = [
                { jobTitle: { $regex: req.query.search, $options: 'i' } }
            ];
        }

        // Filter by jobType (matches DB field name)
        if (req.query.jobType && req.query.jobType !== 'all') {
          query.jobType = req.query.jobType.toLowerCase();
        }

        // Filter by jobCategory (matches DB field name)
        if (req.query.jobCategory && req.query.jobCategory !== 'all') {
          query.jobCategory = req.query.jobCategory.toLowerCase();
        }
        
        // Filter by isRemote - convert string to boolean
        if (req.query.isRemote) {
            query.isRemote = req.query.isRemote === "true"; 
        }

        // Filter by companyId
        if (req.query.companyId) {
            query.companyId = req.query.companyId;
        }

        // Filter by job status
        if (req.query.status) {
            query.status = req.query.status;
        }

        // Pagination - if page param exists, return paginated results
        if (req.query.page) {
            const page = parseInt(req.query.page) || 1;
            const perPage = parseInt(req.query.perPage) || 12;
            const skipItems = (page - 1) * perPage;

            const total = await jobCollection.countDocuments(query);
            const cursor = jobCollection.find(query).skip(skipItems).limit(perPage);
            const jobs = await cursor.toArray();
            
            return res.send({ total, jobs });
        }

        // No pagination - return all matching jobs
        const cursor = jobCollection.find(query);
        const result = await cursor.toArray();
        res.send(result);
    });

    // Get a single job by ID
    app.get('/api/jobs/:id', async (req, res) => {
      const id = req.params.id;
      const query = {
        _id: new ObjectId(id)
      }
      const result = await jobCollection.findOne(query);
      console.log("Job result:", result);
      res.send(result);
    })

    // Create a new job
    app.post('/api/jobs', async (req, res) => {
      const job = req.body;
      const newJob = {
        ...job,
        createdAt: new Date()
      }
      const result = await jobCollection.insertOne(newJob);
      res.send(result);
    })

    //  APPLICATION ROUTES 
    
    // Get applications - protected, seeker only
    // Can filter by applicantId or jobId
    app.get('/api/applications', verifyToken, verifySeeker, async (req, res) => {
      const query = {};

      if (req.query.applicantId) {
        query.applicantId = req.query.applicantId;

        console.log(req.user, req.query.applicantId)

        // Seeker can only see their own applications
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

    // Submit a new job application
    app.post('/api/applications', async (req, res) => {
      const application = req.body;
      const newApplication = {
        ...application,
        createdAt: new Date()
      }
      const result = await applicationsCollection.insertOne(newApplication);
      res.send(result);
    })

    //  COMPANY ROUTES 

    // Get all companies with job counts - admin only
    app.get('/api/companies', verifyToken, verifyAdmin, async (req, res) => {
      const cursor = companyCollection.find();
      const companies = await cursor.toArray();

      // Attach jobCount to each company
      for (const company of companies) {
        const filter = {
          companyId: company._id.toString()
        }
        const jobCount = await jobCollection.countDocuments(filter)
        company.jobCount = jobCount
      }

      res.send(companies);
    })

    // Get companies with aggregation - skip first 5, return next 2
    app.get('/api/companies2', async (req, res) => {
      const pipeline = [
        { $skip: 5 },
        { $limit: 2 }
      ];

      const cursor = companyCollection.aggregate(pipeline);
      const result = await cursor.toArray();
      res.send(result)
    })

    // Get job count stats grouped by jobType
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

    // Get a recruiter's own company by recruiterId
    app.get('/api/my/companies', async (req, res) => {
      const query = {};
      if (req.query.recruiterId) {
        query.recruiterId = req.query.recruiterId;
      }
      const result = await companyCollection.findOne(query);
      res.send(result || {});
    })

    // Register a new company
    app.post('/api/companies', async (req, res) => {
      const company = req.body;
      const newCompany = {
        ...company,
        createdAt: new Date()
      }
      const result = await companyCollection.insertOne(newCompany);
      res.send(result);
    })

    // Update company status (approve/reject) - admin only
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

    // PLAN ROUTES 

    // Get a plan - optionally filter by plan_id
    app.get('/api/plans', async (req, res) => {
      const query = {}
      if (req.query.plan_id) {
        query.id = req.query.plan_id
      }
      const plan = await planCollection.findOne(query);
      res.send(plan)
    })

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