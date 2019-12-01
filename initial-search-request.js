const flamelink = require('flamelink/app')
require('flamelink/content')
require('flamelink/storage')
const admin = require('firebase-admin')
const conf = require('./firebase')
const serviceAccount = require(`./serviceAccountKey.json`)
const algoliasearch = require('algoliasearch')
const removeMd = require('remove-markdown')
const sizeof = require('object-sizeof')

// Init firebase
const firebaseConfig = {
  credential: admin.credential.cert(serviceAccount),
  databaseURL: conf.databaseURL,
  storageBucket: conf.storageBucket
}
const firebaseApp = admin.initializeApp(firebaseConfig)
const db = flamelink({ firebaseApp, isAdminApp: true, env: conf.env }).content

// configure algolia
const algolia = algoliasearch(
  conf.algolia.app_id,
  conf.algolia.api_key
)

const createIndexObject = function (data, url, category) {
  let image

  try {
    image = data.image[0].url
  } catch (error) {
    console.log(`Image for the lesson ${data.title} does not exist`)
  }

  const obj = {
    objectID: data.id,
    url: url,
    title: data.title,
    slug: data.slug,
    category: category,
    date: data.date || data.presentedDate,
    free: data.free || true,
    description: data.description,
    image: image
  }

  let body = data.markdown ? data.markdown : data.body
  body = removeMd(body)
  const size = sizeof(body)

  if (size > 10000) {
    console.log(`TOO BIG ${data.title}:  ${size}`)
    body = body.substr(0, body.length / 2)
    // body = data.markdown ? data.markdown : data.body
    // body = body.split('## ')
    // for (let index = 0; index < body.length; index++) {
    //   let element = body[index]
    //   if (sizeof(element) > 10000) {
    //     element = element.split('```javascript')
    //     for (let index2 = 0; index2 < element.length; index2++) {
    //       const element2 = element[index2]
    //       obj[`body-${index}-${index2}`] = removeMd(element2)

    //       if (sizeof(element2) > 10000) {console.log('yoyoy', element2)}
    //     }
    //   } else {
    //     obj[`body-${index}`] = removeMd(element)
    //   }
    // }
  } else {
    console.log(`${data.title}:  ${size}`)
    obj.body = body
  }

  return obj
}

const getCoursesPage = async function () {
  return db.get({
    schemaKey: 'courses',
    populate: [{
      field: 'lessons',
      subFields: [ 'lessons', 'image', 'status' ],
      populate: [ 'image' ]
    }, {
      field: 'image',
      subFields: [ 'image' ]
    }]})
    .then(async courses => {
      const coursePages = []
      for (const key of Object.keys(courses)) {
        const course = courses[key]
        if (course.hasOwnProperty('lessons')) {
          for (const id of Object.keys(course.lessons)) {
            const lesson = course.lessons[id]
            if (lesson.status === 'published') {
              coursePages.push(createIndexObject(lesson, `/courses/${course.slug}/${lesson.slug}`, 'course'))
            }
          }
        }
      }
      return coursePages
    })
}

const getTalksPage = async function () {
  return db.get({
    schemaKey: 'conference',
    populate: [{
      field: 'talks',
      subFields: [ 'lessons', 'image' ],
      populate: [ 'image' ]
    }, {
      field: 'image',
      subFields: [ 'image' ]
    }]})
    .then(async conferences => {
      const talkPages = []
      for (const key of Object.keys(conferences)) {
        const conference = conferences[key]
        if (conference.hasOwnProperty('talks')) {
          // talkPages.push(createIndexObject(conference, `/conferences/${conference.slug}`, 'conferences'))
          for (const id of Object.keys(conference.talks)) {
            const talk = conference.talks[id]
            if (talk.isVideoLive === 'true') {
              talkPages.push(createIndexObject(talk, `/conferences/${conference.slug}/${talk.slug}`, 'conference'))
            }
          }
        }
      }
      return talkPages
    })
}

const getPostsPage = async function () {
  return db.get({
    schemaKey: 'posts',
    populate: [{
      field: 'image',
      subFields: [ 'image' ]
    }]})
    .then(async posts => {
      const postsPages = []
      for (const key of Object.keys(posts)) {
        const post = posts[key]
        if (post.status === 'published') {
          postsPages.push(createIndexObject(post, `/blog/${post.slug}`, 'blog'))
        }
      }
      return postsPages
    })
}

const saveToAlgolia = async function (type, pages) {
  return algolia.initIndex(type)
    .saveObjects(pages)
    .then(() => {
      console.log(`Content ${type} imported into Algolia`)
    })
    .catch(error => {
      console.error('Error when importing lesson into Algolia', error)
    })
}

const indexAllContent = async function () {
  console.log('Find all content for index')

  const coursesPages = await getCoursesPage(db)
  const talksPages = await getTalksPage(db)
  const postsPages = await getPostsPage(db)

  console.log(coursesPages.length,
    talksPages.length,
    postsPages.length)

  // Get all lessons from Firebase
  await saveToAlgolia('lessons', coursesPages)
  await saveToAlgolia('talks', talksPages)
  await saveToAlgolia('posts', postsPages)

  process.exit(1)
}

indexAllContent()
